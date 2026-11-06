import type { Listing } from './types.ts';
import { normalize, tokenize, tokenMatches } from './text.ts';
import { detectCategory } from './categories.ts';

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

const mainCache = new WeakMap<Listing, string | null>();

/** L'oggetto principale di un annuncio, dal titolo: "Lampada da scrivania in ottone" → lampad. */
export function mainObject(listing: Listing): string | null {
  let main = mainCache.get(listing);
  if (main === undefined) {
    main = detectCategory(tokenize(listing.title))?.keyword ?? null;
    mainCache.set(listing, main);
  }
  return main;
}

/** "bici da corsa" comincia con "bici"; "scarponi da sci" non comincia con "sci". */
function startsWithPhrase(phrase: string, start: string): boolean {
  const a = phrase.split(' ');
  const b = start.split(' ');
  return b.length <= a.length && b.every((w, i) => tokenMatches(a[i], w));
}

/**
 * Vero se l'annuncio è proprio quell'oggetto e non lo nomina soltanto:
 * una lampada da scrivania non è una scrivania, gli scarponi da sci non sono sci.
 * In italiano l'oggetto viene prima ("scarponi da sci"), quindi conta l'inizio.
 * Se dal titolo non si capisce l'oggetto, basta che il testo lo nomini.
 */
export function isMainObject(listing: Listing, alts: string[]): boolean {
  const main = mainObject(listing);
  return !main || alts.some((alt) => startsWithPhrase(main, alt) || startsWithPhrase(alt, main));
}
