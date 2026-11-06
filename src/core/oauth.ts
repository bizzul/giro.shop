/**
 * OAuth 2.1 per il connettore AI, le parti senza database: PKCE, indirizzi di ritorno, permessi, metadati.
 * Riferimenti: RFC 6749/OAuth 2.1, RFC 7636 (PKCE), RFC 7591 (registrazione), RFC 8414 e RFC 9728 (metadati),
 * RFC 8707 (resource), specifica di autorizzazione MCP.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** I permessi che un assistente può chiedere, come li legge la persona nella pagina di consenso. */
export const SCOPES = {
  ricerche: 'Salvare e togliere le tue ricerche con avviso, e vedere quelle che hai',
  annunci: 'Pubblicare annunci a tuo nome, vedere i tuoi annunci e cambiarne prezzo e stato',
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const CODE_TTL_S = 10 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 60 * 24 * 60 * 60;

/** Indirizzo del server MCP che richiede l'accesso (la "risorsa" protetta). */
export const RESOURCE_PATH = '/mcp/account';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256: la sfida è l'impronta SHA-256 del verificatore. Il verificatore è lungo 43–128 caratteri. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(sha256(verifier), challenge);
}

/**
 * Indirizzi di ritorno ammessi: https ovunque, http solo sul proprio computer (app locali),
 * oppure schemi privati delle app (com.esempio.app:/callback). Mai frammenti (#).
 */
export function validRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Schemi privati (RFC 8252): con un punto, come i nomi di dominio rovesciati; niente javascript:, data: e simili
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(url.protocol);
}

/** I permessi chiesti, ripuliti: sconosciuti ignorati; nessuno → tutti (il consenso li mostra comunque). */
export function parseScopes(value: string | null | undefined): Scope[] {
  const asked = (value ?? '').split(/\s+/).filter((s): s is Scope => s in SCOPES);
  return asked.length ? [...new Set(asked)] : ALL_SCOPES;
}

/** La risorsa chiesta (RFC 8707) deve essere il nostro server MCP; senza, vale quella. */
export function resourceMatches(asked: string | null | undefined, expected: string): boolean {
  if (!asked) return true;
  try {
    const a = new URL(asked);
    const e = new URL(expected);
    return a.origin === e.origin && a.pathname.replace(/\/$/, '') === e.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

/** Metadati del server di autorizzazione (RFC 8414). */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/connetti`,
  };
}

/** Metadati della risorsa protetta (RFC 9728): dove si ottiene l'accesso al server MCP. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'giro.shop (il tuo account)',
    resource_documentation: `${origin}/connetti`,
  };
}

export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource${RESOURCE_PATH}`;

/** Risposta di errore OAuth (JSON, mai in cache). */
export function oauthError(error: string, description: string, status = 400, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...headers },
  });
}

export function oauthJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache', ...CORS },
  });
}

/** I client nel browser (es. MCP Inspector) leggono metadati e token da un'altra origine: niente cookie, quindi si può. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
};

export const preflight = () => new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
