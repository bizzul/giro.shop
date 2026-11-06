import { defineMiddleware } from 'astro:middleware';
import { configureStore, refreshListings } from './core/store.ts';
import { createRequestClient, SUPABASE_KEY, SUPABASE_URL } from './lib/supabase.ts';

configureStore(SUPABASE_URL, SUPABASE_KEY);

/**
 * Pagine pubbliche, uguali per tutti e quindi memorizzabili in cache: qui non si legge la sessione,
 * così nessuna risposta in cache può contenere cookie di un utente. Il menu dell'account
 * si carica a parte come server island.
 */
const PUBLIC_PREFIXES = ['/annuncio/', '/foto/', '/_astro/'];
const PUBLIC_PATHS = new Set(['/', '/cerca', '/risultati', '/suggerimenti', '/connetti', '/mcp', '/favicon.svg']);

export const onRequest = defineMiddleware(async (context, next) => {
  await refreshListings();

  context.locals.supabase = null;
  context.locals.user = null;

  const path = context.url.pathname;
  const isPublic = PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (isPublic) return next();

  const extraHeaders: Record<string, string> = {};
  const supabase = createRequestClient(context.request, context.cookies, (h) => Object.assign(extraHeaders, h));
  if (supabase) {
    // Va chiamato prima di generare la risposta: se la sessione va rinnovata, i cookie si scrivono qui.
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    context.locals.supabase = supabase;
    context.locals.user = claims?.sub ? { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined } : null;
  }

  const response = await next();
  // Le risposte che dipendono dall'utente non devono finire in nessuna cache.
  try {
    response.headers.set('Cache-Control', 'private, no-store');
    for (const [key, value] of Object.entries(extraHeaders)) response.headers.set(key, value);
  } catch {
    // Alcune risposte (es. redirect) hanno intestazioni non modificabili.
  }
  return response;
});
