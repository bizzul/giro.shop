import type { Comune, Listing, SearchFilters, SearchHit, SearchResult } from './types.ts';
import { publishedListings } from './store.ts';
import { parseQuery } from './query.ts';
import { findAlt, isMainObject } from './match.ts';
import { getComune, distanceKm } from './comuni.ts';
import { priceVerdict } from './price.ts';
import { CONDITION_LABEL } from './format.ts';

function wheelInches(value: string | undefined): number | null {
  const m = value?.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Ordini possibili dei risultati. "vicini" vale solo se la frase nomina un luogo. */
export const SORT_ORDERS = ['pertinenza', 'recenti', 'prezzo', 'prezzo-desc', 'vicini'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export function parseSort(value: string | null | undefined): SortOrder | undefined {
  return SORT_ORDERS.find((o) => o === value);
}

const byDate = (a: Listing, b: Listing) => b.publishedAt.localeCompare(a.publishedAt);

/** Riordina i risultati; a parità resta l'ordine di pertinenza. */
export function sortHits(hits: SearchHit[], order: SortOrder = 'pertinenza'): SearchHit[] {
  const ranked = [...hits];
  switch (order) {
    case 'recenti':
      return ranked.sort((a, b) => byDate(a.listing, b.listing));
    case 'prezzo':
      return ranked.sort((a, b) => a.listing.priceChf - b.listing.priceChf);
    case 'prezzo-desc':
      return ranked.sort((a, b) => b.listing.priceChf - a.listing.priceChf);
    case 'vicini':
      return ranked.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    default:
      return ranked;
  }
}

/**
 * Ricerca per significato: similarità (0–1) tra la frase e ogni annuncio, per id.
 * La calcola il server con un modello locale (src/lib/semantic.ts); qui si usa e basta.
 */
export type Meaning = ReadonlyMap<string, number>;

/** Sotto questa similarità un annuncio non c'entra (tarata su EmbeddingGemma: "sofà" → divano 0.64, parole a caso < 0.50). */
export const MEANING_MIN = 0.55;
/** E deve stare vicino al più simile: "sofà" porta il divano, non tutto l'arredamento. */
export const MEANING_BAND = 0.05;

/** Gli annunci abbastanza vicini per significato. */
export function meaningMatches(similarities: Meaning): Map<string, number> {
  let top = 0;
  for (const s of similarities.values()) top = Math.max(top, s);
  const floor = Math.max(MEANING_MIN, top - MEANING_BAND);
  return new Map([...similarities].filter(([, s]) => s >= floor));
}

/** Filtri che non dicono "che cosa" si cerca: si tolgono prima di cercare per significato. */
const NOT_MEANING = new Set(['Prezzo', 'Zona', 'Stato', 'Consegna', 'Anno', 'Ruote']);

/**
 * La parte della frase che dice che cosa si cerca, senza prezzo, luogo, stato, consegna, anno e ruote:
 * "sofà sotto 300 franchi a Lugano" → "sofà". Vuota se resta solo un filtro.
 */
export function meaningText(query: string): string {
  let text = query.trim();
  for (let i = 0; i < 8; i++) {
    const chip = parseQuery(text).chips.find((c) => NOT_MEANING.has(c.key) && c.without != null);
    if (!chip) break;
    text = chip.without!.trim();
  }
  return /\p{L}{2,}/u.test(text) ? text : '';
}

export interface SearchOptions {
  /** Quanti risultati restituire (gli altri si contano in total). */
  limit?: number;
  sort?: SortOrder;
  /** Comune di chi cerca: se la frase non nomina un luogo, le distanze ("più vicini") partono da qui. */
  from?: string;
  /** Similarità per significato (già filtrate con meaningMatches): trovano anche chi usa altre parole. */
  meaning?: Meaning;
}

/** Cerca con una frase in linguaggio naturale. */
export function search(query: string, options: SearchOptions = {}): SearchResult {
  const { filters, chips } = parseQuery(query);
  const all = sortHits(rankAll(filters, options.from ? getComune(options.from) : undefined, options.meaning), options.sort);
  const byMeaning = all.filter((h) => h.meaning != null).length;
  return { filters, chips, total: all.length, hits: all.slice(0, options.limit ?? 30), byMeaning };
}

/** Cerca con filtri già strutturati (usato anche dagli strumenti MCP). */
export function searchWithFilters(filters: SearchFilters, limit = 30, meaning?: Meaning): SearchHit[] {
  return rankAll(filters, undefined, meaning).slice(0, limit);
}

/** Tutti gli annunci pubblicati, senza frase: dal più recente, per prezzo o dal più vicino a chi cerca. */
export function browseListings(order: SortOrder = 'recenti', limit = 24, from?: string): { total: number; listings: Listing[] } {
  const all = [...publishedListings()];
  const origin = from ? getComune(from) : undefined;
  const km = (l: Listing) => {
    const c = getComune(l.comuneId);
    return origin && c ? distanceKm(origin, c) : Infinity;
  };
  if (order === 'prezzo') all.sort((a, b) => a.priceChf - b.priceChf || byDate(a, b));
  else if (order === 'prezzo-desc') all.sort((a, b) => b.priceChf - a.priceChf || byDate(a, b));
  else if (order === 'vicini' && origin) all.sort((a, b) => km(a) - km(b) || byDate(a, b));
  else all.sort(byDate);
  return { total: all.length, listings: all.slice(0, limit) };
}

/** Tutti i risultati che corrispondono ai filtri, dal più pertinente. */
function rankAll(filters: SearchFilters, from?: Comune, meaning?: Meaning): SearchHit[] {
  const now = Date.now();
  const hits: SearchHit[] = [];
  for (const listing of publishedListings()) {
    const hit = scoreListing(filters, listing, now, from, meaning);
    if (hit) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score);
}

/**
 * Per gli avvisi serve più somiglianza che per la ricerca: un'email sbagliata disturba più di un risultato in più.
 * Misurato su EmbeddingGemma: «sofà» → "Divano angolare grigio" 0.61, → "Seggiolino auto" 0.58.
 */
export const ALERT_MEANING_MIN = 0.6;

/**
 * Un annuncio corrisponde a una ricerca salvata? Più severo della ricerca normale:
 * deve essere proprio l'oggetto cercato (una lampada "da scrivania" non avvisa chi cerca scrivanie).
 * Con `similarity` (ricerca per significato) vale anche detto con altre parole ("sofà" → divano),
 * se è abbastanza simile; prezzo, zona, stato e gli altri filtri valgono comunque (il prezzo no, con ignorePrice).
 */
export function matchesSearch(query: string, listing: Listing, similarity?: number, options: { ignorePrice?: boolean } = {}): boolean {
  const parsed = parseQuery(query).filters;
  // "Lo cercano in 4": chi cerca lo stesso oggetto conta anche se il suo budget è più basso
  const filters = options.ignorePrice ? { ...parsed, minPrice: undefined, maxPrice: undefined } : parsed;
  const meaning = similarity != null && similarity >= ALERT_MEANING_MIN ? new Map([[listing.id, similarity]]) : undefined;
  if (filters.required) {
    const hasWord = findAlt(listing, filters.required.alts) !== null;
    if (hasWord && !isMainObject(listing, filters.required.alts)) return false;
    if (!hasWord && !meaning) return false;
  }
  return scoreListing(filters, listing, Date.now(), undefined, meaning) !== null;
}

/**
 * Controlla un annuncio contro i filtri: null se non corrisponde, altrimenti punteggio e motivi.
 * Con `meaning`, un annuncio senza le parole cercate entra lo stesso se è simile per significato
 * (gli altri filtri valgono comunque) e finisce dopo quelli che le parole le hanno.
 */
function scoreListing(filters: SearchFilters, listing: Listing, now: number, from?: Comune, meaning?: Meaning): SearchHit | null {
  const origin = filters.comuneId ? getComune(filters.comuneId) : undefined;
  const comune = getComune(listing.comuneId);
  if (!comune) return null;
  const reasons: string[] = [];
  const similarity = meaning?.get(listing.id);
  let viaMeaning = false;

  if (filters.required && !findAlt(listing, filters.required.alts)) {
    if (similarity == null) return null;
    viaMeaning = true;
  }
  if (filters.maxPrice != null && listing.priceChf > filters.maxPrice) return null;
  if (filters.minPrice != null && listing.priceChf < filters.minPrice) return null;
  if (filters.conditions && !filters.conditions.includes(listing.condition)) return null;
  if (filters.shipping && !listing.shipping) return null;

  if (filters.yearFrom != null) {
    const year = Number(listing.attributes.anno);
    if (!year || year < filters.yearFrom || (filters.yearTo != null && year > filters.yearTo)) return null;
    reasons.push(`del ${year}`);
  }

  if (filters.wheelRange) {
    const inches = wheelInches(listing.attributes.ruote);
    const [a, b] = filters.wheelRange;
    if (inches == null || inches < a || inches > b) return null;
    reasons.push(`ruote ${inches}″`);
  }

  let distance: number | undefined;
  if (origin) {
    distance = distanceKm(origin, comune);
    if (filters.radiusKm != null && distance > filters.radiusKm) return null;
  } else if (from) {
    // Solo per ordinare "più vicini a te": nessun raggio, nessun effetto sul punteggio
    distance = distanceKm(from, comune);
  }

  let matched = 0;
  let materialMissed = false;
  for (const g of filters.groups) {
    const word = findAlt(listing, g.alts);
    if (!word) {
      if (g.kind === 'materiale') materialMissed = true;
      continue;
    }
    matched++;
    if (g.kind === 'materiale') reasons.unshift(listing.attributes.materiale ?? word);
  }
  // Il significato aiuta a trovare l'oggetto detto con altre parole ("sofà" → divano), non a cambiare i dettagli:
  // se l'oggetto c'è ma manca il dettaglio chiesto ("poltrona in pelle" → una poltrona in velluto) non vale,
  // e il materiale chiesto non si sostituisce mai con qualcosa di simile.
  if (viaMeaning && materialMissed) return null;
  if (filters.groups.length && matched === 0) {
    if (similarity == null || materialMissed || (filters.required && !viaMeaning)) return null;
    viaMeaning = true;
  }
  if (viaMeaning) reasons.unshift('stesso significato');

  if (filters.maxPrice != null) {
    reasons.push(listing.priceChf <= filters.maxPrice * 0.85 ? 'sotto budget' : 'al limite del budget');
  }
  if (filters.conditions) reasons.push(CONDITION_LABEL[listing.condition].toLowerCase());
  if (filters.includeBroken && listing.condition === 'da_riparare') reasons.push('da riparare');
  if (filters.shipping) reasons.push('si spedisce');

  // Chi cerca "scrivania" vede prima le scrivanie, poi chi la nomina soltanto (lampada da scrivania)
  const sideMention = !viaMeaning && filters.required != null && !isMainObject(listing, filters.required.alts);
  const relevance = viaMeaning
    ? 0.3 + (similarity! - MEANING_MIN) // 0.3–0.75: sotto chi ha le parole cercate
    : (filters.groups.length ? matched / filters.groups.length : 1) - (sideMention ? 0.6 : 0);
  const proximity = origin && distance != null && filters.radiusKm ? 1 - distance / filters.radiusKm : 0;
  const ageDays = (now - new Date(listing.publishedAt).getTime()) / 864e5;
  const freshness = Math.max(0, 1 - ageDays / 14);
  const score =
    relevance * 100 +
    proximity * 25 +
    freshness * 10 +
    (listing.seller.verified ? 3 : 0) +
    (filters.category && listing.category === filters.category ? 5 : 0);

  return { listing, comune, distanceKm: distance, score, reasons, verdict: priceVerdict(listing), meaning: viaMeaning ? similarity : undefined };
}

/** Annunci simili a uno dato, per la scheda annuncio. */
export function similarTo(id: string, title: string, limit = 4): SearchHit[] {
  const { filters } = parseQuery(title);
  const loose: SearchFilters = { raw: title, required: filters.required, category: filters.category, groups: [] };
  const alts = filters.required?.alts;
  return rankAll(loose)
    .filter((h) => h.listing.id !== id && (!alts || isMainObject(h.listing, alts)))
    .slice(0, limit);
}
