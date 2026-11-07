import type { Listing } from '../core/types.ts';
import { demandFor, searchedObject, wantedBoard, type Demand, type SavedSearch, type SearchCount, type WantedItem } from '../core/demand.ts';
import { adminClient } from './admin.ts';
import { similaritiesFor, similaritiesToText } from './semantic.ts';

/**
 * Domanda dalle ricerche salvate, lato server: le ricerche si leggono con la chiave di servizio
 * e ne escono solo numeri aggregati (vedi core/demand.ts).
 */

let cache: { at: number; searches: SavedSearch[] } | null = null;

/** Dopo che qualcuno salva o toglie una ricerca: la prossima lettura va al database. */
export function forgetSavedSearches(): void {
  cache = null;
}

/** Le ricerche salvate di tutti, al massimo 20 secondi vecchie. */
export async function savedSearches(): Promise<SavedSearch[]> {
  if (cache && Date.now() - cache.at < 20_000) return cache.searches;
  const admin = adminClient();
  if (!admin) return [];
  const { data } = await admin.from('alerts').select('user_id, query').order('created_at', { ascending: false }).limit(3000);
  const searches = (data ?? []).map((r) => ({ userId: r.user_id as string, query: r.query as string }));
  cache = { at: Date.now(), searches };
  return searches;
}

/** Per una bozza (ancora senza vettore): chi cerca un oggetto così, a qualsiasi prezzo. */
export async function demandForDraft(draft: Listing): Promise<Demand> {
  const searches = await savedSearches();
  const meaning = await similaritiesToText(draft, searches.map((s) => s.query)).catch(() => new Map<string, number>());
  return demandFor(draft, searches, meaning);
}

/** Per gli annunci di chi vende: quante persone li cercano, annuncio per annuncio. */
export async function demandForListings(listings: Listing[]): Promise<Map<string, Demand>> {
  const searches = await savedSearches();
  const out = new Map<string, Demand>();
  if (!searches.length || !listings.length) return out;
  const sims = await similaritiesFor(searches.map((s) => s.query), listings.map((l) => l.id)).catch(() => new Map<string, Map<string, number>>());
  for (const l of listings) {
    const meaning = new Map<string, number>();
    for (const [query, byListing] of sims) {
      const sim = byListing.get(l.id);
      if (sim != null) meaning.set(query, sim);
    }
    out.set(l.id, demandFor(l, searches, meaning));
  }
  return out;
}

let counted: { at: number; counts: SearchCount[] } | null = null;

/** Le ricerche fatte sul sito negli ultimi 7 giorni, per oggetto e zona (copia di al massimo 20 secondi). */
export async function searchCounts(): Promise<SearchCount[]> {
  if (counted && Date.now() - counted.at < 20_000) return counted.counts;
  const admin = adminClient();
  if (!admin) return [];
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { data } = await admin.from('search_counts').select('label, district, n').gte('day', since).limit(5000);
  const sums = new Map<string, SearchCount>();
  for (const r of data ?? []) {
    const key = `${r.label}|${r.district}`;
    const c = sums.get(key) ?? { label: r.label as string, district: r.district as string, searches: 0 };
    c.searches += Number(r.n);
    sums.set(key, c);
  }
  counted = { at: Date.now(), counts: [...sums.values()] };
  return counted.counts;
}

/** Le richieste per la pagina Cercasi e la striscia in home: ricerche salvate e ricerche fatte. */
export async function cercasi(): Promise<WantedItem[]> {
  const [searches, counts] = await Promise.all([savedSearches(), searchCounts()]);
  return wantedBoard(searches, counts);
}

/** Conta una ricerca fatta sul sito: solo l'oggetto riconosciuto e la zona. false se non nomina un oggetto conosciuto. */
export async function countSearch(q: string): Promise<boolean> {
  const object = searchedObject(q);
  const admin = adminClient();
  if (!object || !admin) return false;
  const { error } = await admin.rpc('count_search', { p_term: object.term, p_label: object.label, p_district: object.district });
  return !error;
}

/** Dalla manutenzione: i conteggi più vecchi di 60 giorni non servono più e si tolgono. */
export async function pruneSearchCounts(): Promise<void> {
  const admin = adminClient();
  if (!admin) return;
  await admin.from('search_counts').delete().lt('day', new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10));
}
