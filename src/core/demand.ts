import type { District, Listing } from './types.ts';
import { getComune } from './comuni.ts';
import { parseQuery } from './query.ts';
import { matchesSearch } from './search.ts';
import { normalize, sentenceCase } from './text.ts';

/**
 * "Lo cercano in 4": quante ricerche salvate corrispondono a un oggetto e con che budget,
 * e le richieste più frequenti (pagina Cercasi, striscia in home), anche dalle ricerche fatte sul sito.
 * Sempre e solo numeri aggregati: nessun nome, e i budget solo quando sono almeno due.
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

type Group = { label: string; query: string; district: District | null; users: Map<string, number | undefined> };

/** Le ricerche salvate raggruppate per oggetto e zona, con il budget più alto di ogni persona. */
function groupSearches(searches: SavedSearch[]): Map<string, Group> {
  const groups = new Map<string, Group>();
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
  return groups;
}

/** Budget mediano, se almeno due persone l'hanno indicato. */
function medianBudget(g: Group): number | null {
  const budgets = [...g.users.values()].filter((b): b is number => b != null).sort((a, b) => a - b);
  return budgets.length >= MIN_PEOPLE ? budgets[Math.floor((budgets.length - 1) / 2)] : null;
}

/** Le richieste più frequenti, per oggetto e zona: solo i gruppi con almeno due persone. */
export function demandGroups(searches: SavedSearch[], limit = 30): DemandGroup[] {
  return [...groupSearches(searches).values()]
    .filter((g) => g.users.size >= MIN_PEOPLE)
    .map((g) => ({ label: g.label, query: g.query, district: g.district, people: g.users.size, budget: medianBudget(g) }))
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Le ricerche fatte sul sito si contano anonime: solo l'oggetto riconosciuto ("Bici da corsa") e la zona,
 * mai la frase intera né chi cerca. null se la frase non nomina un oggetto conosciuto.
 */
export function searchedObject(q: string): { term: string; label: string; district: string } | null {
  const { filters } = parseQuery(q);
  if (!filters.required || !filters.categoryLabel) return null;
  const label = filters.categoryLabel;
  return { term: normalize(label), label, district: filters.comuneId ? (getComune(filters.comuneId)?.district ?? '') : '' };
}

/** Ricerche fatte per oggetto e zona, negli ultimi giorni. */
export interface SearchCount {
  label: string;
  district: string;
  searches: number;
}

/** Da quante ricerche in 7 giorni un oggetto compare tra le richieste, anche senza ricerche salvate. */
export const MIN_SEARCHES = 3;

export interface WantedItem extends DemandGroup {
  /** Ricerche fatte sul sito negli ultimi 7 giorni. */
  searches: number;
}

/**
 * Le richieste per la home e per Cercasi: persone con una ricerca salvata (almeno due) e ricerche fatte sul sito
 * (almeno MIN_SEARCHES), per oggetto e zona. Prima quelle con più persone, poi con più ricerche.
 */
export function wantedBoard(searches: SavedSearch[], counts: SearchCount[], limit = 30): WantedItem[] {
  const groups = groupSearches(searches);
  const items = new Map<string, WantedItem>();
  for (const [key, g] of groups) {
    const people = g.users.size >= MIN_PEOPLE ? g.users.size : 0;
    items.set(key, { label: g.label, query: g.query, district: g.district, people, budget: people ? medianBudget(g) : null, searches: 0 });
  }
  for (const c of counts) {
    const key = `${normalize(c.label)}|${c.district}`;
    const item = items.get(key) ?? { label: c.label, query: c.label.toLowerCase(), district: (c.district || null) as District | null, people: 0, budget: null, searches: 0 };
    item.searches += c.searches;
    items.set(key, item);
  }
  return [...items.values()]
    .filter((i) => i.people >= MIN_PEOPLE || i.searches >= MIN_SEARCHES)
    .sort((a, b) => b.people * 5 + b.searches - (a.people * 5 + a.searches) || a.label.localeCompare(b.label))
    .slice(0, limit);
}
