import type { APIContext, MiddlewareNext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { configureStore, refreshListings } from './core/store.ts';
import { createRequestClient, SUPABASE_KEY, SUPABASE_SERVER_URL, SUPABASE_URL } from './lib/supabase.ts';
import { maybeRunMaintenance } from './lib/maintenance.ts';
import { invalidateListingPages } from './lib/cache.ts';
import { crossSiteResponse, isCrossSiteForm } from './lib/origin-check.ts';
import { withSecurityHeaders } from './lib/security-headers.ts';

configureStore(SUPABASE_SERVER_URL, SUPABASE_KEY, SUPABASE_URL);

/**
 * Pagine pubbliche, uguali per tutti e quindi memorizzabili in cache: qui non si legge la sessione,
 * così nessuna risposta in cache può contenere cookie di un utente. Il menu dell'account
 * si carica a parte come server island.
 */
const PUBLIC_PREFIXES = ['/annuncio/', '/usato/', '/venditore/', '/foto/', '/_astro/', '/.well-known/', '/mcp/', '/og/'];
const PUBLIC_PATHS = new Set([
  '/',
  '/cerca',
  '/risultati',
  '/suggerimenti',
  '/connetti',
  '/mcp',
  // OAuth del connettore AI: i client chiamano senza cookie (solo /oauth/authorize legge la sessione)
  '/oauth/token',
  '/oauth/register',
  '/oauth/revoke',
  '/favicon.svg',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/site.webmanifest',
  '/og.png',
  '/sicurezza',
  '/cercasi',
  '/confronta',
  '/traduci',
  '/cerca-foto',
  '/email-avvisi',
  '/privacy',
  '/condizioni',
  '/robots.txt',
  '/sitemap.xml',
]);

export const onRequest = defineMiddleware(async (context, next) => {
  // Le intestazioni di sicurezza valgono per tutte le risposte, anche per quelle che finiscono in cache
  return withSecurityHeaders(await handle(context, next), context.url);
});

async function handle(context: APIContext, next: MiddlewareNext): Promise<Response> {
  // Moduli da altri siti: rifiutati, tranne gli endpoint OAuth dei token (vedi lib/origin-check.ts)
  if (isCrossSiteForm(context.request, context.url)) return crossSiteResponse(context.request);
  await refreshListings();
  // Promemoria di scadenza e annunci scaduti: al massimo ogni 15 minuti, senza far aspettare la richiesta
  maybeRunMaintenance(context.url.origin, () => invalidateListingPages(context));

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
}
