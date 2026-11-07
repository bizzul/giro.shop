import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Condition, Listing, Photo, PhotoCredit, PricePoint, Question } from './types.ts';
import { LISTINGS } from '../data/listings.ts';
import { PHOTOS } from '../data/photos.ts';

/**
 * Accesso agli annunci.
 *
 * Con Supabase configurato, il server tiene in memoria una copia degli annunci pubblicati e venduti,
 * aggiornata al massimo ogni 10 secondi (e subito dopo ogni pubblicazione). Ricerca, stime di prezzo
 * e strumenti MCP lavorano su questa copia, in modo sincrono e veloce.
 * Senza Supabase (test, demo offline) si usano i dati di prova.
 */

const MAX_AGE_MS = 10_000;
/** Le colonne della copia in memoria: la usa anche `pnpm test:db` per controllare che la query funzioni. */
export const LISTING_SELECT = `
  id, title, description, category_id, tags, attributes, price_chf, negotiable, condition, comune_id,
  status, published_at, created_at, expires_at, sold_price_chf, seller_id, buyer_id, shipping, shipping_chf, highlights,
  seller:profiles!listings_seller_id_fkey(display_name, phone_verified_at),
  photos:listing_photos(storage_path, position, credit, width, height),
  history:price_history(price_chf, changed_at),
  questions(id, body, answer, created_at, answered_at, helpful, asker:profiles!questions_asker_id_fkey(display_name))
`;

const SEED: Listing[] = LISTINGS.map((l) => ({ ...l, photos: PHOTOS[l.id] ? [PHOTOS[l.id]] : [] }));

let supabaseUrl: string | null = null;
let serverUrl: string | null = null;
let client: SupabaseClient | null = null;
let snapshot: Listing[] | null = null;
let loadedAt = 0;
let pending: Promise<void> | null = null;

/** Collega il negozio a Supabase. Senza url e chiave restano i dati di prova. */
/**
 * `url` è l'indirizzo con cui il server legge gli annunci; `publicUrl` (se diverso) quello dei link alle foto,
 * che aprono i browser (es. dietro un tunnel: server su 127.0.0.1, foto sull'indirizzo pubblico).
 */
export function configureStore(url: string | undefined, key: string | undefined, publicUrl?: string): void {
  if (!url || !key || (url === serverUrl && (publicUrl ?? url) === supabaseUrl)) return;
  serverUrl = url;
  supabaseUrl = publicUrl ?? url;
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  snapshot = null;
  loadedAt = 0;
}

export function usingDatabase(): boolean {
  return client !== null;
}

/** URL pubblico di un file nel bucket "foto"; i percorsi che iniziano con "/" sono file del sito. */
export function photoUrl(path: string): string {
  if (path.startsWith('/') || path.startsWith('http')) return path;
  return `${supabaseUrl}/storage/v1/object/public/foto/${path}`;
}

interface Row {
  id: string;
  title: string;
  description: string;
  category_id: Listing['category'];
  tags: string[];
  attributes: Record<string, string>;
  price_chf: number | string;
  negotiable: boolean;
  condition: Condition;
  comune_id: string;
  status: string;
  published_at: string | null;
  created_at: string;
  expires_at?: string | null;
  sold_price_chf: number | string | null;
  seller_id: string | null;
  buyer_id?: string | null;
  shipping?: boolean;
  shipping_chf?: number | string | null;
  highlights?: string[] | null;
  seller: { display_name: string; phone_verified_at: string | null } | null;
  photos: Array<{ storage_path: string; position: number; credit: PhotoCredit | null; width: number | null; height: number | null }>;
  history?: Array<{ price_chf: number | string; changed_at: string }>;
  questions?: Array<{
    id: string;
    body: string;
    answer: string | null;
    created_at: string;
    answered_at: string | null;
    helpful?: number | null;
    asker: { display_name: string } | null;
  }>;
}

/** Converte una riga di Supabase nel modello usato da ricerca, pagine e MCP. */
export function rowToListing(row: Row): Listing {
  const photos: Photo[] = [...(row.photos ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const src = photoUrl(p.storage_path);
      return {
        src,
        // Le foto di esempio hanno una versione piccola accanto; quelle caricate no.
        srcSmall: p.storage_path.startsWith('/foto/') ? src.replace(/\.webp$/, '-sm.webp') : src,
        width: p.width ?? 1280,
        height: p.height ?? 960,
        credit: p.credit,
      };
    });
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category_id,
    tags: row.tags ?? [],
    attributes: row.attributes ?? {},
    priceChf: Number(row.price_chf),
    negotiable: row.negotiable,
    condition: row.condition,
    comuneId: row.comune_id,
    publishedAt: row.published_at ?? row.created_at,
    status: row.status === 'venduto' ? 'venduto' : 'pubblicato',
    soldPriceChf: row.sold_price_chf != null ? Number(row.sold_price_chf) : undefined,
    seller: { name: row.seller?.display_name ?? 'Utente', verified: Boolean(row.seller?.phone_verified_at) },
    sellerId: row.seller_id ?? undefined,
    negotiating: row.status === 'in_trattativa',
    photos,
    shipping: Boolean(row.shipping),
    shippingChf: row.shipping_chf != null ? Number(row.shipping_chf) : undefined,
    buyerId: row.buyer_id ?? undefined,
    highlights: row.highlights?.length ? row.highlights : undefined,
    priceHistory: row.history
      ? row.history
          .map((h): PricePoint => ({ priceChf: Number(h.price_chf), at: h.changed_at }))
          .sort((a, b) => a.at.localeCompare(b.at))
      : undefined,
    questions: row.questions
      ? row.questions
          .map(
            (q): Question => ({
              id: q.id,
              body: q.body,
              askerName: q.asker?.display_name ?? 'Utente',
              createdAt: q.created_at,
              answer: q.answer ?? undefined,
              answeredAt: q.answered_at ?? undefined,
              helpful: q.helpful ?? 0,
            }),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : undefined,
  };
}

async function load(): Promise<void> {
  if (!client) return;
  const { data, error } = await client
    .from('listings')
    .select(LISTING_SELECT)
    .in('status', ['pubblicato', 'in_trattativa', 'venduto'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) {
    console.error(`[piazza] Supabase non risponde (${error.message}): uso ${snapshot ? "l'ultima copia" : 'i dati di prova'}.`);
    loadedAt = Date.now();
    return;
  }
  // Un annuncio scaduto sparisce subito, anche prima che il server lo segni come "scaduto"
  const now = Date.now();
  const live = (data as unknown as Row[]).filter(
    (r) => r.status === 'venduto' || !r.expires_at || new Date(r.expires_at).getTime() > now,
  );
  snapshot = live.map(rowToListing);
  loadedAt = Date.now();
}

/** Aggiorna la copia in memoria se è più vecchia di 10 secondi (o sempre, con force). */
export async function refreshListings(force = false): Promise<void> {
  if (!client) return;
  if (!force && snapshot && Date.now() - loadedAt < MAX_AGE_MS) return;
  pending ??= load().finally(() => {
    pending = null;
  });
  await pending;
}

export function allListings(): Listing[] {
  return snapshot ?? SEED;
}

export function publishedListings(): Listing[] {
  return allListings().filter((l) => l.status === 'pubblicato');
}

export function getListing(id: string): Listing | undefined {
  return allListings().find((l) => l.id === id);
}

/** Prima foto dell'annuncio. */
export function getPhoto(listingId: string): Photo | undefined {
  return getListing(listingId)?.photos?.[0];
}

const SOURCE_NAMES: Record<string, string> = { flickr: 'Flickr', wikimedia: 'Wikimedia Commons' };

export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function latestListings(limit = 8): Listing[] {
  return [...publishedListings()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}
