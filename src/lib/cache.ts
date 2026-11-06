import type { ActionAPIContext } from 'astro:actions';

/** Etichetta delle pagine in cache che mostrano annunci (home e schede). */
export const LISTINGS_TAG = 'annunci';

/** Dopo una modifica, svuota la cache delle pagine con annunci: le modifiche si vedono subito. */
export async function invalidateListingPages(context: Pick<ActionAPIContext, 'cache'>): Promise<void> {
  try {
    await context.cache.invalidate({ tags: [LISTINGS_TAG] });
  } catch {
    // Nessuna cache attiva (es. in sviluppo): non c'è nulla da svuotare.
  }
}
