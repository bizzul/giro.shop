import type { Listing } from './types.ts';
import { normalize, tokenMatches } from './text.ts';

interface Haystack {
  tokens: string[];
  padded: string;
}

const cache = new WeakMap<Listing, Haystack>();

/** Tutto il testo di un annuncio, normalizzato una volta sola. */
export function haystack(listing: Listing): Haystack {
  let h = cache.get(listing);
  if (!h) {
    const text = normalize(
      [listing.title, listing.description, listing.tags.join(' '), Object.values(listing.attributes).join(' ')].join(' '),
    );
    h = { tokens: text.split(' '), padded: ` ${text} ` };
    cache.set(listing, h);
  }
  return h;
}

/** Restituisce la parola dell'annuncio che corrisponde a una delle alternative, o null. */
export function findAlt(listing: Listing, alts: string[]): string | null {
  const h = haystack(listing);
  for (const alt of alts) {
    if (alt.includes(' ')) {
      if (h.padded.includes(` ${alt}`)) return alt;
      continue;
    }
    const token = h.tokens.find((t) => tokenMatches(t, alt));
    if (token) return token;
  }
  return null;
}
