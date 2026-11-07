import type { Listing } from '../core/types.ts';
import { demandFor, demandGroups, type Demand, type DemandGroup, type SavedSearch } from '../core/demand.ts';
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

/** La pagina Cercasi. */
export async function cercasi(): Promise<DemandGroup[]> {
  return demandGroups(await savedSearches());
}
