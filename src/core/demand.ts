import type { District, Listing } from './types.ts';
import { getComune } from './comuni.ts';
import { parseQuery } from './query.ts';
import { matchesSearch } from './search.ts';
import { normalize, sentenceCase } from './text.ts';

/**
 * "Lo cercano in 4": quante ricerche salvate corrispondono a un oggetto e con che budget,
 * e la pagina Cercasi con le richieste più frequenti. Sempre e solo numeri aggregati:
 * nessun nome, e i budget solo quando sono almeno due.
 */

export interface SavedSearch {
  userId: string;
  query: string;
}

export interface Demand {
  /** Persone diverse con almeno una ricerca salvata che corrisponde. */
  people: number;
  /** Budget più basso e più alto tra chi ne ha indicato uno (solo se almeno due). */
  budget: { low: number; high: number; count: number } | null;
}

/** Per i gruppi e i budget: almeno due persone, così nessuno è riconoscibile. */
export const MIN_PEOPLE = 2;

const budgetOf = (query: string) => parseQuery(query).filters.maxPrice;

/** Chi cerca questo oggetto, a qualsiasi prezzo. `similarity` (facoltativa): somiglianza per significato con ogni frase. */
export function demandFor(listing: Listing, searches: SavedSearch[], similarity?: ReadonlyMap<string, number>): Demand {
  const byUser = new Map<string, number | undefined>();
  for (const s of searches) {
    if (s.userId === listing.sellerId) continue;
    if (!matchesSearch(s.query, listing, similarity?.get(s.query), { ignorePrice: true })) continue;
    const budget = budgetOf(s.query);
    const prev = byUser.get(s.userId);
    byUser.set(s.userId, prev == null ? budget : budget == null ? prev : Math.max(prev, budget));
  }
  const budgets = [...byUser.values()].filter((b): b is number => b != null).sort((a, b) => a - b);
  return {
    people: byUser.size,
    budget: budgets.length >= MIN_PEOPLE ? { low: budgets[0], high: budgets.at(-1)!, count: budgets.length } : null,
  };
}

export interface DemandGroup {
  /** Cosa si cerca: "Bici da corsa", "Passeggini", "Sofà". */
  label: string;
  /** La frase da usare per cercare o vendere. */
  query: string;
  district: District | null;
  people: number;
  /** Budget mediano, se almeno due persone l'hanno indicato. */
  budget: number | null;
}

/** Le richieste più frequenti, per oggetto e zona: solo i gruppi con almeno due persone. */
export function demandGroups(searches: SavedSearch[], limit = 30): DemandGroup[] {
  const groups = new Map<string, { label: string; query: string; district: District | null; users: Map<string, number | undefined> }>();
  for (const s of searches) {
    const { filters } = parseQuery(s.query);
    const label = filters.required && filters.categoryLabel ? filters.categoryLabel : sentenceCase(s.query.trim()).slice(0, 40);
    const query = filters.required && filters.categoryLabel ? filters.categoryLabel.toLowerCase() : s.query.trim().toLowerCase();
    const district = filters.comuneId ? (getComune(filters.comuneId)?.district ?? null) : null;
    const key = `${normalize(label)}|${district ?? ''}`;
    const g = groups.get(key) ?? { label, query, district, users: new Map() };
    const budget = filters.maxPrice;
    const prev = g.users.get(s.userId);
    g.users.set(s.userId, prev == null ? budget : budget == null ? prev : Math.max(prev, budget));
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.users.size >= MIN_PEOPLE)
    .map((g) => {
      const budgets = [...g.users.values()].filter((b): b is number => b != null).sort((a, b) => a - b);
      return {
        label: g.label,
        query: g.query,
        district: g.district,
        people: g.users.size,
        budget: budgets.length >= MIN_PEOPLE ? budgets[Math.floor((budgets.length - 1) / 2)] : null,
      };
    })
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label))
    .slice(0, limit);
}
