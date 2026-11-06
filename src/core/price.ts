import type { CategoryId, Condition, Listing, PriceEstimate, PriceVerdict } from './types.ts';
import { allListings } from './store.ts';
import { parseQuery } from './query.ts';
import { findAlt, isMainObject } from './match.ts';

/** Quanto vale un oggetto rispetto allo stesso oggetto in buono stato. */
const CONDITION_FACTOR: Record<Condition, number> = {
  nuovo: 1.25,
  come_nuovo: 1.1,
  buono: 1,
  usato: 0.85,
  da_riparare: 0.5,
};

function effectivePrice(l: Listing): number {
  return l.status === 'venduto' && l.soldPriceChf ? l.soldPriceChf : l.priceChf;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function roundNice(v: number): number {
  const step = v < 100 ? 5 : v < 1000 ? 10 : 50;
  return Math.max(step, Math.round(v / step) * step);
}

export interface EstimateInput {
  /** Descrizione libera dell'oggetto: "bici da corsa Bianchi telaio 55". */
  text: string;
  category?: CategoryId;
  condition?: Condition;
  excludeId?: string;
}

/**
 * Stima una fascia di prezzo dagli annunci simili, pubblicati e venduti.
 * I prezzi vengono riportati allo stato "buono" e poi adattati allo stato richiesto.
 */
export function estimatePrice(input: EstimateInput): PriceEstimate | null {
  const { filters } = parseQuery(input.text);
  const category = input.category ?? filters.category;
  const pool = allListings().filter((l) => l.id !== input.excludeId && effectivePrice(l) > 0);

  let comps: Listing[] = [];
  let basis: PriceEstimate['basis'] = 'simili';
  if (filters.required) {
    const req = filters.required.alts;
    // Lo stesso oggetto, non uno che lo nomina: niente lampade "da scrivania" per stimare una scrivania
    comps = pool.filter((l) => findAlt(l, req) && isMainObject(l, req));
  }
  if (comps.length < 3 && category) {
    comps = pool.filter((l) => l.category === category);
    basis = 'categoria';
  }
  if (comps.length === 0) return null;

  // Prima gli annunci che condividono più parole (marca, modello, materiale)
  const ranked = comps
    .map((l) => ({ l, overlap: filters.groups.filter((g) => findAlt(l, g.alts)).length }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 15)
    .map((x) => x.l);

  const base = ranked.map((l) => effectivePrice(l) / CONDITION_FACTOR[l.condition]).sort((a, b) => a - b);
  const factor = CONDITION_FACTOR[input.condition ?? 'buono'];
  const mid = quantile(base, 0.5) * factor;
  const low = Math.min(quantile(base, 0.25) * factor, mid * 0.85);
  const high = Math.max(quantile(base, 0.75) * factor, mid * 1.15);

  const confidence: PriceEstimate['confidence'] =
    basis === 'categoria' || ranked.length < 3 ? 'bassa' : ranked.length >= 5 ? 'alta' : 'media';

  return {
    low: roundNice(low),
    mid: roundNice(mid),
    high: roundNice(high),
    comparables: ranked.length,
    soldComparables: ranked.filter((l) => l.status === 'venduto').length,
    basis,
    confidence,
    comparableIds: ranked.map((l) => l.id),
  };
}

/** Confronta il prezzo di un annuncio con la stima degli annunci simili. */
export function priceVerdict(listing: Listing): PriceVerdict | undefined {
  if (listing.priceChf <= 0) return undefined;
  const est = estimatePrice({
    text: `${listing.title} ${listing.tags.join(' ')}`,
    category: listing.category,
    condition: listing.condition,
    excludeId: listing.id,
  });
  // Solo un confronto con oggetti davvero simili: una bici per bambini non si giudica con le bici da corsa.
  if (!est || est.basis !== 'simili' || est.comparables < 3) return undefined;
  if (listing.priceChf < est.low) return 'sotto_mercato';
  if (listing.priceChf > est.high) return 'sopra_mercato';
  return 'prezzo_giusto';
}
