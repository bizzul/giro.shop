import type { Listing, PriceEstimate, PriceVerdict } from './types.ts';
import { getComune } from './comuni.ts';
import { VERDICT_LABEL, formatChf, formatChfRange } from './format.ts';

/** Le caratteristiche che dicono di più, nell'ordine in cui le cerca chi compra. */
const KEY_ATTRIBUTES = ['misure', 'taglia', 'ruote', 'anno', 'materiale', 'capacità', 'memoria', 'modello'];

/** Lo stato detto come lo direbbe una persona. */
const CONDITION_PHRASE: Record<Listing['condition'], string> = {
  nuovo: 'Nuovo, mai usato',
  come_nuovo: 'Come nuovo',
  buono: 'In buono stato',
  usato: "Usato, con segni d'uso",
  da_riparare: 'Da riparare',
};

/**
 * "In sintesi" senza Claude: tre righe costruite dai dati dell'annuncio
 * (stato e misura principale, consegna, prezzo rispetto agli annunci simili).
 */
export function ruleHighlights(listing: Listing, estimate: PriceEstimate | null, verdict: PriceVerdict | undefined): string[] {
  const points: string[] = [];

  const attr = KEY_ATTRIBUTES.map((k) => [k, listing.attributes[k]] as const).find(([, v]) => v);
  points.push(`${CONDITION_PHRASE[listing.condition]}${attr ? ` · ${attr[0]} ${attr[1]}` : ''}`);

  const comune = getComune(listing.comuneId);
  const pickup = comune ? `Ritiro ${/^[aA]/.test(comune.name) ? 'ad' : 'a'} ${comune.name}` : 'Ritiro da concordare';
  const ship = listing.shipping
    ? listing.shippingChf != null
      ? `, spedizione ${formatChf(listing.shippingChf)}`
      : ', spedizione da concordare'
    : '';
  points.push(`${pickup}${ship}`);

  if (listing.priceChf === 0) points.push('Lo regala: basta passare a prenderlo');
  else if (verdict && estimate) points.push(`${VERDICT_LABEL[verdict]}: annunci simili ${formatChfRange(estimate.low, estimate.high)}`);
  else if (listing.negotiable) points.push('Prezzo trattabile');

  return points;
}
