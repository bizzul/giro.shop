import type { Listing } from '../core/types.ts';
import { getListing, refreshListings } from '../core/store.ts';
import { matchesSearch } from '../core/search.ts';
import { getComune } from '../core/comuni.ts';
import { formatChf } from '../core/format.ts';
import { summarizeListing } from '../core/claude.ts';
import { adminClient } from './admin.ts';
import { claudeKey } from './claude.ts';
import { favoritersOf, notify, type Notice } from './notify.ts';
import { embedListingLater } from './semantic.ts';

/**
 * Cosa succede dopo un cambiamento a un annuncio: avvisi a chi l'aspettava e punti chiave.
 * Gira dopo la risposta, così chi pubblica o modifica non aspetta email e Claude.
 */

type Invalidate = () => Promise<void>;
const later = (task: Promise<unknown>, what: string) => void task.catch((e) => console.warn(`[giro] ${what}: ${(e as Error).message}`));

const describe = (l: Listing) => [l.title, formatChf(l.priceChf), getComune(l.comuneId)?.name].filter(Boolean).join(' · ');

/** Annuncio appena pubblicato: avvisa chi ha una ricerca salvata che corrisponde, scrive i punti chiave. */
export function afterPublish(listingId: string, origin: string, invalidate: Invalidate): void {
  later(notifySavedSearches(listingId, origin), 'avvisi delle ricerche salvate');
  later(writeHighlights(listingId, invalidate), 'punti chiave');
  embedListingLater(listingId);
}

/** Testo cambiato: i punti chiave vecchi non valgono più. */
export function afterTextChange(listingId: string, invalidate: Invalidate): void {
  later(writeHighlights(listingId, invalidate), 'punti chiave');
  embedListingLater(listingId);
}

async function notifySavedSearches(listingId: string, origin: string): Promise<void> {
  const admin = adminClient();
  const listing = getListing(listingId);
  if (!admin || !listing) return;
  const { data: searches } = await admin.from('alerts').select('id, user_id, query').neq('user_id', listing.sellerId ?? '');
  const hits = (searches ?? []).filter((s) => matchesSearch(s.query, listing));
  if (!hits.length) return;
  // Una persona con più ricerche che corrispondono riceve un solo avviso
  const byUser = new Map<string, { id: string; query: string }>();
  for (const s of hits) if (!byUser.has(s.user_id)) byUser.set(s.user_id, { id: s.id, query: s.query });
  const notices: Notice[] = [...byUser].map(([userId, s]) => ({
    userId,
    kind: 'ricerca',
    title: `Nuovo annuncio per «${s.query}»`,
    body: describe(listing),
    url: `/annuncio/${listing.id}`,
    listingId: listing.id,
  }));
  await notify(notices, origin);
  await admin.from('alerts').update({ last_notified_at: new Date().toISOString() }).in('id', hits.map((s) => s.id));
}

async function writeHighlights(listingId: string, invalidate: Invalidate): Promise<void> {
  const admin = adminClient();
  const key = claudeKey();
  if (!admin) return;
  const listing = getListing(listingId);
  if (!listing) return;
  // Senza chiave si azzerano: la scheda usa le regole semplici, mai punti vecchi su un testo nuovo
  const points = key && listing.description.trim().length > 20 ? await summarizeListing(key, listing) : [];
  await admin.from('listings').update({ highlights: points }).eq('id', listingId);
  await refreshListings(true);
  await invalidate();
}

/** Prezzo abbassato: avvisa chi ha salvato l'annuncio. */
export async function afterPriceChange(listing: Listing, oldPrice: number, newPrice: number, origin: string): Promise<void> {
  if (!(newPrice < oldPrice)) return;
  const users = (await favoritersOf(listing.id)).filter((u) => u !== listing.sellerId);
  await notify(
    users.map((userId) => ({
      userId,
      kind: 'prezzo' as const,
      title: `Prezzo ridotto: ${listing.title}`,
      body: `Da ${formatChf(oldPrice)} a ${formatChf(newPrice)}`,
      url: `/annuncio/${listing.id}`,
      listingId: listing.id,
    })),
    origin,
  );
}

/** Venduto: avvisa chi l'aveva salvato e chiede a chi vende e a chi compra di valutarsi. */
export async function afterSale(listing: Listing, buyerId: string | null, buyerName: string | null, origin: string): Promise<void> {
  const notices: Notice[] = (await favoritersOf(listing.id))
    .filter((u) => u !== listing.sellerId && u !== buyerId)
    .map((userId) => ({
      userId,
      kind: 'venduto',
      title: `Venduto: ${listing.title}`,
      body: 'Un annuncio che avevi salvato non è più disponibile. Puoi salvare una ricerca per essere avvisato del prossimo.',
      url: `/annuncio/${listing.id}`,
      listingId: listing.id,
    }));
  if (buyerId && listing.sellerId) {
    notices.push(
      {
        userId: buyerId,
        kind: 'valutazione',
        title: `Com'è andata con ${listing.seller.name}?`,
        body: `Lascia una valutazione per «${listing.title}»: aiuta chi compra dopo di te.`,
        url: `/valuta/${listing.id}`,
        listingId: listing.id,
      },
      {
        userId: listing.sellerId,
        kind: 'valutazione',
        title: `Com'è andata con ${buyerName ?? 'chi ha comprato'}?`,
        body: `Lascia una valutazione per la vendita di «${listing.title}».`,
        url: `/valuta/${listing.id}`,
        listingId: listing.id,
      },
    );
  }
  await notify(notices, origin);
}
