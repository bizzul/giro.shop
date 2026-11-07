/**
 * Intestazioni di sicurezza su tutte le risposte che passano dal middleware (pagine, endpoint, azioni, server island).
 * - HSTS: dopo la prima visita il browser usa solo https, anche se qualcuno scrive o linka http:// (solo su https).
 * - Niente cornici da altri siti (clickjacking): offerte, pagamenti, «Ho ricevuto l'oggetto» e cancellazioni non si
 *   possono far cliccare di nascosto dentro una pagina altrui. /oauth/authorize mette già la sua e resta quella.
 * - nosniff: il browser non indovina il tipo di un file (un testo non diventa mai uno script).
 * - Referrer: agli altri siti arriva solo l'indirizzo del sito, mai il percorso (es. /messaggi/<id>, /pagamento/<id>).
 * - Permissions-Policy: la posizione solo per noi («Distanze da te»), microfono, pagamenti, USB e Topics spenti.
 *   La fotocamera resta libera: «Cerca con una foto» usa il campo file con capture.
 * I file statici (public/ e /_astro/) li serve l'adapter senza passare dal middleware.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Permissions-Policy': 'geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()',
};

/** Un anno: il minimo per l'elenco dei siti solo https dei browser. Senza sottodomini, che non sono nostri da decidere. */
export const HSTS = 'max-age=31536000';

/** Aggiunge le intestazioni che mancano; quelle già messe da una pagina restano. */
export function withSecurityHeaders(response: Response, url: URL): Response {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (url.protocol === 'https:') headers['Strict-Transport-Security'] = HSTS;
  let out = response;
  try {
    apply(out.headers, headers);
  } catch {
    // Intestazioni non modificabili (es. una risposta presa con fetch): stessa risposta, intestazioni copiate
    out = new Response(response.body, response);
    apply(out.headers, headers);
  }
  return out;
}

function apply(target: Headers, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) if (!target.has(key)) target.set(key, value);
}
