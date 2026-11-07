import type { SupabaseClient } from '@supabase/supabase-js';
import { bulkPrice, parseBulk } from '../core/bulk.ts';
import type { CatalogRow } from '../core/catalog.ts';
import { getCategory } from '../core/categories.ts';
import { matchesSearch } from '../core/search.ts';
import { allListings, getListing, refreshListings } from '../core/store.ts';
import type { Listing } from '../core/types.ts';
import { normalize } from '../core/text.ts';
import { adminClient } from './admin.ts';
import { fetchImage, ImageFetchError } from './fetch-image.ts';
import { afterPriceChange, afterPublish } from './listing-events.ts';

/**
 * Negozi Pro, lato server: modifiche in blocco a parole (con ritorno ai prezzi di prima alla scadenza),
 * import del catalogo da CSV e i numeri del negozio.
 */

export class ProError extends Error {}

export async function isPro(userId: string): Promise<boolean> {
  const { data } = (await adminClient()?.rpc('is_pro', { p_user: userId })) ?? { data: false };
  return Boolean(data);
}

export async function requirePro(userId: string): Promise<void> {
  if (!(await isPro(userId))) throw new ProError('Serve un negozio Pro attivo.');
}

export interface BulkItem {
  id: string;
  title: string;
  old: number;
  next: number;
}

/** Gli annunci in vendita del negozio che la frase sceglie, con il prezzo nuovo. */
export function bulkPreview(userId: string, phrase: string, now = new Date()) {
  const plan = parseBulk(phrase, now);
  if ('error' in plan) throw new ProError(plan.error);
  const mine = allListings().filter((l) => l.sellerId === userId && l.status === 'pubblicato');
  const picked = plan.query ? mine.filter((l) => matchesQuery(plan.query, l)) : mine;
  const items: BulkItem[] = picked
    .filter((l) => l.priceChf > 0)
    .map((l) => ({ id: l.id, title: l.title, old: l.priceChf, next: bulkPrice(l.priceChf, plan.pct) }))
    .filter((i) => i.next !== i.old);
  return { plan, items };
}

/** "sci" sceglie gli sci; anche il nome della categoria ("arredamento", "auto") va bene. */
function matchesQuery(query: string, l: Listing): boolean {
  const q = normalize(query);
  if (normalize(getCategory(l.category).name).startsWith(q) || l.category === q.replace(/ /g, '_')) return true;
  return matchesSearch(query, l, undefined, { ignorePrice: true });
}

export async function bulkApply(supabase: SupabaseClient, userId: string, phrase: string, origin: string, invalidate: () => Promise<void>) {
  await requirePro(userId);
  const { plan, items } = bulkPreview(userId, phrase);
  if (!items.length) throw new ProError('Nessun annuncio in vendita corrisponde alla frase.');
  const done: BulkItem[] = [];
  for (const item of items) {
    const { data } = await supabase.from('listings').update({ price_chf: item.next }).eq('id', item.id).eq('seller_id', userId).select('id');
    if (data?.length) done.push(item);
  }
  await adminClient()!
    .from('bulk_changes')
    .insert({ user_id: userId, phrase: phrase.slice(0, 200), pct: plan.pct, ends_at: plan.endsAt, items: done.map((i) => ({ listing_id: i.id, old: i.old, new: i.next })) });
  await refreshListings(true);
  await invalidate();
  // Chi ha salvato un annuncio scontato riceve l'avviso del prezzo ridotto
  for (const item of done) {
    const listing = getListing(item.id);
    if (listing && item.next < item.old) await afterPriceChange(listing, item.old, item.next, origin);
  }
  return { changed: done.length, endsAt: plan.endsAt };
}

/** Prezzi di prima: alla scadenza (manutenzione) o subito. Solo se nel frattempo il prezzo non è stato cambiato a mano. */
export async function restoreBulk(id: string, userId?: string): Promise<number> {
  const admin = adminClient()!;
  let query = admin.from('bulk_changes').select('id, user_id, items').eq('id', id).is('restored_at', null);
  if (userId) query = query.eq('user_id', userId);
  const { data: change } = await query.maybeSingle();
  if (!change) throw new ProError('Modifica non trovata o già annullata.');
  let n = 0;
  for (const item of change.items as Array<{ listing_id: string; old: number; new: number }>) {
    const { data } = await admin.from('listings').update({ price_chf: item.old }).eq('id', item.listing_id).eq('price_chf', item.new).select('id');
    n += data?.length ?? 0;
  }
  await admin.from('bulk_changes').update({ restored_at: new Date().toISOString() }).eq('id', change.id);
  await refreshListings(true);
  return n;
}

export async function restoreExpiredBulk(invalidate: () => Promise<void>, now = new Date()): Promise<number> {
  const admin = adminClient();
  if (!admin) return 0;
  const { data } = await admin.from('bulk_changes').select('id').is('restored_at', null).not('ends_at', 'is', null).lte('ends_at', now.toISOString());
  for (const c of data ?? []) await restoreBulk(c.id);
  if (data?.length) await invalidate();
  return data?.length ?? 0;
}

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as const;

/** Importa le righe valide del catalogo: con le foto in vendita subito, senza in bozza. */
export async function importCatalog(supabase: SupabaseClient, userId: string, rows: CatalogRow[], origin: string, invalidate: () => Promise<void>) {
  await requirePro(userId);
  const published: string[] = [];
  const drafts: string[] = [];
  const failed: Array<{ line: number; why: string }> = [];
  for (const row of rows) {
    if (row.errors.length || row.priceChf == null || !row.comuneId) continue;
    const photos: Array<{ type: keyof typeof EXTENSION; bytes: Buffer }> = [];
    for (const url of row.photos) {
      try {
        photos.push(await fetchImage(url));
      } catch (error) {
        failed.push({ line: row.line, why: `foto ${url}: ${error instanceof ImageFetchError ? error.message : 'non scaricata'}` });
      }
    }
    const { data: listing, error } = await supabase
      .from('listings')
      .insert({
        seller_id: userId,
        status: photos.length ? 'pubblicato' : 'bozza',
        title: row.title,
        description: row.description,
        category_id: row.category,
        tags: [],
        attributes: {},
        price_chf: row.priceChf,
        condition: row.condition,
        comune_id: row.comuneId,
        shipping: row.shipping,
        ai_source: 'manuale',
      })
      .select('id')
      .single();
    if (error || !listing) {
      failed.push({ line: row.line, why: error?.message ?? 'non creato' });
      continue;
    }
    for (const [i, photo] of photos.entries()) {
      const path = `${userId}/${listing.id}/${i}.${EXTENSION[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('foto').upload(path, photo.bytes, { contentType: photo.type });
      if (!uploadError) await supabase.from('listing_photos').insert({ listing_id: listing.id, storage_path: path, position: i });
    }
    (photos.length ? published : drafts).push(listing.id);
  }
  await refreshListings(true);
  await invalidate();
  for (const id of published) afterPublish(id, origin, invalidate);
  return { published: published.length, drafts: drafts.length, failed };
}

/** I numeri del negozio: annunci, visite, contatti, vendite e giorni per vendere. */
export async function shopNumbers(supabase: SupabaseClient, userId: string) {
  const [{ data: stats }, { data: rows }] = await Promise.all([
    supabase.rpc('my_listing_stats'),
    supabase.from('listings').select('status, published_at, sold_at').eq('seller_id', userId),
  ]);
  const s = (stats ?? []) as Array<{ views_total: number; views_week: number; saves: number; contacts: number }>;
  const sum = (k: keyof (typeof s)[number]) => s.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const list = rows ?? [];
  const sold = list.filter((r) => r.status === 'venduto' && r.published_at && r.sold_at);
  const monthAgo = Date.now() - 30 * 864e5;
  const days = sold.map((r) => (new Date(r.sold_at!).getTime() - new Date(r.published_at!).getTime()) / 864e5);
  return {
    onSale: list.filter((r) => r.status === 'pubblicato' || r.status === 'in_trattativa').length,
    drafts: list.filter((r) => r.status === 'bozza').length,
    views: sum('views_total'),
    viewsWeek: sum('views_week'),
    saves: sum('saves'),
    contacts: sum('contacts'),
    soldMonth: sold.filter((r) => new Date(r.sold_at!).getTime() > monthAgo).length,
    daysToSell: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
  };
}
