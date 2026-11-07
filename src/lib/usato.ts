import { COMUNI, getComune } from '../core/comuni.ts';
import { OGGETTI, getOggetto, type Oggetto } from '../core/seo.ts';
import { search } from '../core/search.ts';
import type { Comune } from '../core/types.ts';

/**
 * Pagine /usato/<oggetto> e /usato/<oggetto>/<comune> per i motori di ricerca: la ricerca a frasi con un indirizzo
 * fisso («Divani a Lugano»), senza categorie nell'interfaccia. Nella sitemap solo quelle con almeno un annuncio,
 * e per i comuni solo quelli dove c'è davvero un annuncio di quell'oggetto.
 */
export interface UsatoPage {
  oggetto: Oggetto;
  comune?: Comune;
  query: string;
  path: string;
}

export function usatoPage(oggettoSlug: string, comuneId?: string): UsatoPage | null {
  const oggetto = getOggetto(oggettoSlug);
  const comune = comuneId ? getComune(comuneId) : undefined;
  if (!oggetto || (comuneId && !comune)) return null;
  return {
    oggetto,
    comune,
    query: comune ? `${oggetto.label} a ${comune.name}` : oggetto.label,
    path: `/usato/${oggetto.slug}${comune ? `/${comune.id}` : ''}`,
  };
}

export function usatoSitemap(): string[] {
  const paths: string[] = [];
  for (const oggetto of OGGETTI) {
    const hits = search(oggetto.label, { limit: 480 }).hits;
    if (!hits.length) continue;
    paths.push(`/usato/${oggetto.slug}`);
    const comuni = new Set(hits.map((h) => h.listing.comuneId));
    for (const c of COMUNI) if (comuni.has(c.id)) paths.push(`/usato/${oggetto.slug}/${c.id}`);
  }
  return paths;
}
