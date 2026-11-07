import type { SupabaseClient } from '@supabase/supabase-js';
import { dropPrice, priceTip, QUIET_DAYS } from '../core/insights.ts';
import { estimatePrice } from '../core/price.ts';
import { getListing, refreshListings } from '../core/store.ts';
import { formatChf, formatChfRange } from '../core/format.ts';
import { formatPickup } from '../core/pickup.ts';
import { afterPriceChange } from './listing-events.ts';
import { notify, type Notice } from './notify.ts';

/**
 * Lavori periodici per chi vende (dalla manutenzione, ogni 15 minuti al massimo):
 * - ribasso automatico: il prezzo scende secondo la regola scelta, mai sotto il minimo;
 * - consiglio sul prezzo: una volta per annuncio, se è sopra il mercato e nessuno scrive da giorni;
 * - ritiri fissati: promemoria il giorno prima e "com'è andato?" dopo.
 */

interface DropRow {
  listing_id: string;
  seller_id: string;
  drop_pct: number;
  drop_every_days: number;
  drop_floor_chf: number | string;
  drop_from: string | null;
  drop_last_at: string | null;
  listing: { price_chf: number | string; status: string; title: string; hidden_at: string | null } | null;
}

/** Applica i ribassi arrivati a scadenza. Restituisce quanti prezzi sono cambiati. */
export async function applyPriceDrops(admin: SupabaseClient, origin: string, invalidate: () => Promise<void>, now = new Date()): Promise<number> {
  const { data } = await admin
    .from('listing_settings')
    .select('listing_id, seller_id, drop_pct, drop_every_days, drop_floor_chf, drop_from, drop_last_at, listing:listings(price_chf, status, title, hidden_at)')
    .not('drop_pct', 'is', null);
  const done: Array<{ id: string; seller: string; title: string; old: number; next: number; floor: number; days: number }> = [];
  for (const row of (data ?? []) as unknown as DropRow[]) {
    const l = row.listing;
    // In trattativa o nascosto: il prezzo non si tocca
    if (!l || l.status !== 'pubblicato' || l.hidden_at || !row.drop_from) continue;
    const old = Number(l.price_chf);
    const rule = { pct: row.drop_pct, everyDays: row.drop_every_days, floorChf: Number(row.drop_floor_chf), from: row.drop_from, lastAt: row.drop_last_at };
    const next = dropPrice(old, rule, now);
    if (next == null) continue;
    // Solo se nel frattempo chi vende non ha cambiato il prezzo
    const { data: changed } = await admin.from('listings').update({ price_chf: next }).eq('id', row.listing_id).eq('price_chf', old).select('id');
    if (!changed?.length) continue;
    await admin.from('listing_settings').update({ drop_last_at: now.toISOString() }).eq('listing_id', row.listing_id);
    done.push({ id: row.listing_id, seller: row.seller_id, title: l.title, old, next, floor: rule.floorChf, days: rule.everyDays });
  }
  if (!done.length) return 0;

  await refreshListings(true);
  await invalidate();
  for (const d of done) {
    const listing = getListing(d.id);
    if (listing) await afterPriceChange(listing, d.old, d.next, origin);
  }
  await notify(
    done.map((d) => ({
      userId: d.seller,
      kind: 'consiglio' as const,
      title: `Ribasso automatico: «${d.title}» ora costa ${formatChf(d.next)}`,
      body:
        d.next > d.floor
          ? `Prima costava ${formatChf(d.old)}. Il prossimo ribasso arriva tra ${d.days} giorni, mai sotto ${formatChf(d.floor)}.`
          : `Prima costava ${formatChf(d.old)}. Ora è al minimo che hai scelto: non scenderà più.`,
      url: `/miei-annunci/${d.id}`,
      listingId: d.id,
    })),
    origin,
  );
  return done.length;
}

/** Consiglio sul prezzo, una volta per annuncio. Non a chi ha già il ribasso automatico. */
export async function sendPriceTips(admin: SupabaseClient, origin: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - QUIET_DAYS * 864e5).toISOString();
  const { data: rows } = await admin
    .from('listings')
    .select('id, seller_id, published_at')
    .eq('status', 'pubblicato')
    .is('hidden_at', null)
    .not('seller_id', 'is', null)
    .lte('published_at', cutoff)
    .limit(500);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (!ids.length) return 0;
  const { data: settings } = await admin.from('listing_settings').select('listing_id, price_tip_at, drop_pct').in('listing_id', ids);
  const skip = new Set((settings ?? []).filter((s) => s.price_tip_at || s.drop_pct != null).map((s) => s.listing_id as string));
  const { data: convs } = await admin.from('conversations').select('listing_id, created_at').in('listing_id', ids);
  const lastContact = new Map<string, string>();
  for (const c of convs ?? []) {
    const prev = lastContact.get(c.listing_id);
    if (!prev || prev < c.created_at) lastContact.set(c.listing_id, c.created_at);
  }

  const notices: Notice[] = [];
  for (const row of rows ?? []) {
    const listing = getListing(row.id);
    if (skip.has(row.id) || !listing) continue;
    const estimate = estimatePrice({ text: `${listing.title} ${listing.tags.join(' ')}`, category: listing.category, condition: listing.condition, excludeId: listing.id });
    const tip = priceTip({ priceChf: listing.priceChf, publishedAt: row.published_at, lastContactAt: lastContact.get(row.id), estimate, now });
    if (!tip) continue;
    notices.push({
      userId: row.seller_id,
      kind: 'consiglio',
      title: `«${listing.title}»: nessun contatto da ${tip.quietDays} giorni`,
      body: `Costa il ${tip.overPct}% in più degli annunci simili (${formatChfRange(tip.low, tip.high)}). Con ${formatChf(tip.suggested)} o con il ribasso automatico lo vedono più persone.`,
      url: `/miei-annunci#a-${listing.id}`,
      listingId: listing.id,
    });
  }
  if (!notices.length) return 0;
  await notify(notices, origin);
  await admin.from('listing_settings').upsert(
    notices.map((n) => ({ listing_id: n.listingId!, seller_id: n.userId, price_tip_at: now.toISOString() })),
    { onConflict: 'listing_id' },
  );
  return notices.length;
}

interface PickupRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  pickup_at: string;
  pickup_place: string | null;
  listing: { title: string; status: string } | null;
  buyer: { display_name: string } | null;
  seller: { display_name: string } | null;
}

const PICKUP_SELECT = `id, listing_id, buyer_id, seller_id, pickup_at, pickup_place, listing:listings(title, status),
  buyer:profiles!conversations_buyer_id_fkey(display_name), seller:profiles!conversations_seller_id_fkey(display_name)`;

/**
 * Ritiri fissati: un promemoria a tutti e due nelle 24 ore prima e, due ore dopo il ritiro,
 * la domanda "com'è andato?" a chi vende, se l'annuncio è ancora in vendita.
 */
export async function pickupReminders(admin: SupabaseClient, origin: string, now = new Date()): Promise<number> {
  const { data: upcoming } = await admin
    .from('conversations')
    .select(PICKUP_SELECT)
    .is('pickup_outcome', null)
    .is('pickup_reminded_at', null)
    .gt('pickup_at', now.toISOString())
    .lte('pickup_at', new Date(now.getTime() + 24 * 36e5).toISOString());
  const notices: Notice[] = [];
  const reminded: string[] = [];
  for (const c of (upcoming ?? []) as unknown as PickupRow[]) {
    if (!c.listing || !['pubblicato', 'in_trattativa'].includes(c.listing.status)) continue;
    const when = formatPickup(c.pickup_at, now);
    const where = c.pickup_place ? ` · ${c.pickup_place}` : '';
    reminded.push(c.id);
    notices.push(
      {
        userId: c.buyer_id,
        kind: 'ritiro',
        title: `Ritiro ${when}: «${c.listing.title}»`,
        body: `Con ${c.seller?.display_name ?? 'chi vende'}${where}. Paga solo quando hai visto l'oggetto.`,
        url: `/messaggi/${c.id}`,
        listingId: c.listing_id,
      },
      {
        userId: c.seller_id,
        kind: 'ritiro',
        title: `Ritiro ${when}: «${c.listing.title}»`,
        body: `Con ${c.buyer?.display_name ?? 'chi compra'}${where}. Se cambia qualcosa, scrivilo nella conversazione.`,
        url: `/messaggi/${c.id}`,
        listingId: c.listing_id,
      },
    );
  }

  const { data: past } = await admin
    .from('conversations')
    .select(PICKUP_SELECT)
    .is('pickup_outcome', null)
    .is('sold_asked_at', null)
    .lte('pickup_at', new Date(now.getTime() - 2 * 36e5).toISOString())
    .gt('pickup_at', new Date(now.getTime() - 14 * 864e5).toISOString());
  const asked: string[] = [];
  for (const c of (past ?? []) as unknown as PickupRow[]) {
    asked.push(c.id);
    if (!c.listing || !['pubblicato', 'in_trattativa'].includes(c.listing.status)) continue;
    notices.push({
      userId: c.seller_id,
      kind: 'consiglio',
      title: `Com'è andato il ritiro di «${c.listing.title}»?`,
      body: `Se l'hai venduto a ${c.buyer?.display_name ?? 'chi è passato'}, segnalo con un tocco: l'annuncio sparisce dalle ricerche e potete valutarvi.`,
      url: `/miei-annunci#a-${c.listing_id}`,
      listingId: c.listing_id,
    });
  }
  if (reminded.length) await admin.from('conversations').update({ pickup_reminded_at: now.toISOString() }).in('id', reminded);
  if (asked.length) await admin.from('conversations').update({ sold_asked_at: now.toISOString() }).in('id', asked);
  if (notices.length) await notify(notices, origin);
  return notices.length;
}
