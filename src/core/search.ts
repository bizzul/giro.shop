import type { SearchFilters, SearchHit, SearchResult } from './types.ts';
import { publishedListings } from './store.ts';
import { parseQuery } from './query.ts';
import { findAlt } from './match.ts';
import { getComune, distanceKm } from './comuni.ts';
import { priceVerdict } from './price.ts';
import { CONDITION_LABEL } from './format.ts';

function wheelInches(value: string | undefined): number | null {
  const m = value?.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Cerca con una frase in linguaggio naturale. */
export function search(query: string, limit = 30): SearchResult {
  const { filters, chips } = parseQuery(query);
  return { filters, chips, hits: searchWithFilters(filters, limit) };
}

/** Cerca con filtri già strutturati (usato anche dagli strumenti MCP). */
export function searchWithFilters(filters: SearchFilters, limit = 30): SearchHit[] {
  const origin = filters.comuneId ? getComune(filters.comuneId) : undefined;
  const now = Date.now();
  const hits: SearchHit[] = [];

  for (const listing of publishedListings()) {
    const comune = getComune(listing.comuneId);
    if (!comune) continue;
    const reasons: string[] = [];

    if (filters.required && !findAlt(listing, filters.required.alts)) continue;
    if (filters.maxPrice != null && listing.priceChf > filters.maxPrice) continue;
    if (filters.minPrice != null && listing.priceChf < filters.minPrice) continue;
    if (filters.conditions && !filters.conditions.includes(listing.condition)) continue;

    if (filters.yearFrom != null) {
      const year = Number(listing.attributes.anno);
      if (!year || year < filters.yearFrom || (filters.yearTo != null && year > filters.yearTo)) continue;
      reasons.push(`del ${year}`);
    }

    if (filters.wheelRange) {
      const inches = wheelInches(listing.attributes.ruote);
      const [a, b] = filters.wheelRange;
      if (inches == null || inches < a || inches > b) continue;
      reasons.push(`ruote ${inches}″`);
    }

    let distance: number | undefined;
    if (origin) {
      distance = distanceKm(origin, comune);
      if (filters.radiusKm != null && distance > filters.radiusKm) continue;
    }

    let matched = 0;
    for (const g of filters.groups) {
      const word = findAlt(listing, g.alts);
      if (!word) continue;
      matched++;
      if (g.kind === 'materiale') reasons.unshift(listing.attributes.materiale ?? word);
    }
    if (filters.groups.length && matched === 0) continue;

    if (filters.maxPrice != null) {
      reasons.push(listing.priceChf <= filters.maxPrice * 0.85 ? 'sotto budget' : 'al limite del budget');
    }
    if (filters.conditions) reasons.push(CONDITION_LABEL[listing.condition].toLowerCase());
    if (filters.includeBroken && listing.condition === 'da_riparare') reasons.push('da riparare');

    const relevance = filters.groups.length ? matched / filters.groups.length : 1;
    const proximity = distance != null && filters.radiusKm ? 1 - distance / filters.radiusKm : 0;
    const ageDays = (now - new Date(listing.publishedAt).getTime()) / 864e5;
    const freshness = Math.max(0, 1 - ageDays / 14);
    const score =
      relevance * 100 +
      proximity * 25 +
      freshness * 10 +
      (listing.seller.verified ? 3 : 0) +
      (filters.category && listing.category === filters.category ? 5 : 0);

    hits.push({
      listing,
      comune,
      distanceKm: distance,
      score,
      reasons,
      verdict: priceVerdict(listing),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Annunci simili a uno dato, per la scheda annuncio. */
export function similarTo(id: string, title: string, limit = 4): SearchHit[] {
  const { filters } = parseQuery(title);
  const loose: SearchFilters = { raw: title, required: filters.required, category: filters.category, groups: [] };
  return searchWithFilters(loose, limit + 1)
    .filter((h) => h.listing.id !== id)
    .slice(0, limit);
}
