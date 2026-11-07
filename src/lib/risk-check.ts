import { estimatePrice } from '../core/price.ts';
import { listingRisk } from '../core/risk.ts';
import { getListing, publishedListings } from '../core/store.ts';
import { normalize } from '../core/text.ts';
import { adminClient } from './admin.ts';
import { embedListing, nearDuplicateOf } from './semantic.ts';

/**
 * Calcola e salva il rischio truffa di un annuncio (dopo pubblicazione e modifiche).
 * Se il punteggio sale rispetto a quello già controllato da chi modera, l'annuncio torna da guardare.
 */
export async function checkListingRisk(listingId: string): Promise<void> {
  const admin = adminClient();
  const listing = getListing(listingId);
  if (!admin || !listing) return;
  await embedListing(listingId);
  // Testo copiato: stesso testo normalizzato o vettore quasi identico, di un'altra persona
  const text = normalize(listing.description);
  const sameText =
    text.length > 40 ? publishedListings().find((l) => l.id !== listing.id && l.sellerId !== listing.sellerId && normalize(l.description) === text)?.id : undefined;
  const risk = listingRisk({
    title: listing.title,
    description: listing.description,
    priceChf: listing.priceChf,
    estimate: estimatePrice({ text: `${listing.title} ${listing.tags.join(' ')}`, category: listing.category, condition: listing.condition, excludeId: listing.id }),
    copiedFrom: sameText ?? nearDuplicateOf(listing.id),
    verified: listing.seller.verified,
  });
  const { data: before } = await admin.from('listing_risk').select('reviewed_score').eq('listing_id', listingId).maybeSingle();
  const stillReviewed = before?.reviewed_score != null && risk.score <= Number(before.reviewed_score);
  await admin.from('listing_risk').upsert({
    listing_id: listingId,
    score: risk.score,
    signals: risk.signals,
    reasons: risk.reasons,
    checked_at: new Date().toISOString(),
    ...(stillReviewed ? {} : { reviewed_at: null, reviewed_by: null, reviewed_score: null }),
  });
}
