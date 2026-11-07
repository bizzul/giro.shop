import type { APIRoute } from 'astro';
import { allow } from '../lib/claude.ts';
import { countSearch } from '../lib/demand.ts';

/**
 * Una ricerca fatta sul sito, per "Si cerca in Ticino" e Cercasi. La manda il browser quando la ricerca
 * si ferma (Invio, o qualche secondo senza scrivere), una volta per sessione e frase.
 * Si conta solo l'oggetto riconosciuto e la zona: niente frase intera, nessuna persona, nessun indirizzo IP.
 */
export const POST: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
  // Un tetto in tutto il sito: niente numeri gonfiati da chi manda richieste a raffica
  if (q.length >= 2 && allow('cercato', 600, 60 * 60_000)) await countSearch(q);
  return new Response(null, { status: 204 });
};
