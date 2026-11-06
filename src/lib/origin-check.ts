/**
 * Protezione dai moduli inviati da altri siti (CSRF), come il controllo di Astro (security.checkOrigin),
 * ma con un'eccezione: gli endpoint OAuth dei token li chiamano anche client nel browser di altre origini
 * (es. MCP Inspector), con un modulo application/x-www-form-urlencoded e senza cookie.
 * Per questo in astro.config.mjs checkOrigin è spento e il controllo sta nel middleware (pagine, endpoint e azioni).
 */

/** Endpoint che accettano moduli da altre origini: non usano cookie, l'identità è nel corpo (client_id, codice, token). */
export const CROSS_ORIGIN_FORM_PATHS = new Set(['/oauth/token', '/oauth/revoke']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/** true se la richiesta è un modulo che arriva da un altro sito e va rifiutata. Stessa logica di Astro 7. */
export function isCrossSiteForm(request: Request, url: URL): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  if (CROSS_ORIGIN_FORM_PATHS.has(url.pathname)) return false;
  // Altri tipi (es. application/json) passano dal controllo CORS del browser
  const type = request.headers.get('content-type')?.toLowerCase();
  if (type && !FORM_TYPES.some((t) => type.includes(t))) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return false;
  if (site) return true;
  const origin = request.headers.get('origin');
  return Boolean(origin) && origin !== url.origin;
}

export const crossSiteResponse = (request: Request) => new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
