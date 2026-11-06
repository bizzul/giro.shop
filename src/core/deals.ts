import type { Listing, PriceEstimate } from './types.ts';
import { publishedListings } from './store.ts';
import { estimatePrice, priceVerdict } from './price.ts';

export interface Deal {
  listing: Listing;
  estimate: PriceEstimate;
  /** Quanto costa meno degli annunci simili, in percentuale (arrotondata). */
  savingPct: number;
}

/**
 * Affare del giorno: un annuncio recente sotto il prezzo degli annunci simili.
 * Tra i tre migliori si cambia ogni giorno, così la home non mostra sempre lo stesso.
 * Nessuna urgenza finta: niente conti alla rovescia, solo il confronto con i simili.
 */
export function dealOfTheDay(now = new Date()): Deal | null {
  const recent = now.getTime() - 14 * 864e5;
  const candidates: Deal[] = [];
  for (const listing of publishedListings()) {
    if (listing.negotiating || listing.priceChf <= 0 || new Date(listing.publishedAt).getTime() < recent) continue;
    if (priceVerdict(listing) !== 'sotto_mercato') continue;
    const estimate = estimatePrice({
      text: `${listing.title} ${listing.tags.join(' ')}`,
      category: listing.category,
      condition: listing.condition,
      excludeId: listing.id,
    });
    if (!estimate) continue;
    candidates.push({ listing, estimate, savingPct: Math.round((1 - listing.priceChf / estimate.mid) * 100) });
  }
  if (!candidates.length) return null;
  const best = candidates.sort((a, b) => b.savingPct - a.savingPct).slice(0, 3);
  const day = Math.floor(now.getTime() / 864e5);
  return best[day % best.length];
}
