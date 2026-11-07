/**
 * Il contenuto delle email che dipende dagli annunci: la scheda (foto, prezzo, luogo, badge) di un avviso,
 * presa dalla copia in memoria degli annunci. Il disegno sta in email-design.ts.
 */
import { getListing } from '../core/store.ts';
import { getComune } from '../core/comuni.ts';
import { formatChf, isNew, VERDICT_LABEL } from '../core/format.ts';
import { priceVerdict } from '../core/price.ts';
import { C, type CardListing } from './email-design.ts';

const absolute = (src: string, origin: string) => (/^https?:\/\//.test(src) ? src : `${origin}${src}`);

/** La scheda di un annuncio per un'email; null se l'avviso non riguarda un annuncio o l'annuncio non c'è più. */
export function emailCard(listingId: string | null | undefined, origin: string, url: string, small = false): CardListing | null {
  const listing = listingId ? getListing(listingId) : undefined;
  if (!listing) return null;
  const photo = listing.photos?.[0];
  const badges: Array<{ text: string; dot: string }> = [];
  if (listing.status === 'venduto') badges.push({ text: 'Venduto', dot: C.muted });
  else {
    if (isNew(listing.publishedAt)) badges.push({ text: 'Nuovo oggi', dot: C.sun });
    const verdict = priceVerdict(listing);
    if (verdict) badges.push({ text: VERDICT_LABEL[verdict], dot: verdict === 'sopra_mercato' ? C.muted : C.ok });
  }
  const comune = getComune(listing.comuneId)?.name;
  return {
    url: `${origin}${url}`,
    photo: photo ? absolute(small ? photo.srcSmall : photo.src, origin) : null,
    title: listing.title,
    price: formatChf(listing.priceChf),
    place: [comune, listing.shipping ? 'si spedisce' : null].filter(Boolean).join(' · '),
    badges: badges.slice(0, 2),
  };
}
