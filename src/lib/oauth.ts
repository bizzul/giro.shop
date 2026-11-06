/**
 * OAuth 2.1 per il connettore AI, le parti con il database (solo chiave di servizio).
 * Codici e token sono casuali (256 bit) e se ne salva solo l'impronta: chi legge il database non li può usare.
 */
import { adminClient } from './admin.ts';
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  REFRESH_TTL_S,
  SCOPES,
  pkceMatches,
  randomToken,
  safeEqual,
  sha256,
  validRedirectUri,
  type Scope,
} from '../core/oauth.ts';

export class OAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function db() {
  const admin = adminClient();
  if (!admin) throw new OAuthError('server_error', 'Accesso non configurato su questo server (manca SUPABASE_SECRET_KEY).', 503);
  return admin;
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

export interface OAuthClient {
  id: string;
  name: string;
  uri: string | null;
  redirect_uris: string[];
  secret_hash: string | null;
}

/** Registrazione dinamica (RFC 7591): chiunque può registrare un client, ma serve sempre il sì della persona. */
export async function registerClient(meta: Record<string, unknown>) {
  const redirects = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!redirects.length || redirects.length > 10 || !redirects.every(validRedirectUri)) {
    throw new OAuthError('invalid_redirect_uri', 'Servono da 1 a 10 redirect_uris: https, oppure http solo su localhost.');
  }
  const grants = Array.isArray(meta.grant_types) ? meta.grant_types : ['authorization_code', 'refresh_token'];
  if (!grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) {
    throw new OAuthError('invalid_client_metadata', 'Sono ammessi solo authorization_code e refresh_token.');
  }
  const responses = Array.isArray(meta.response_types) ? meta.response_types : ['code'];
  if (!responses.every((r) => r === 'code')) throw new OAuthError('invalid_client_metadata', 'È ammesso solo response_type "code".');
  const method = typeof meta.token_endpoint_auth_method === 'string' ? meta.token_endpoint_auth_method : 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
    throw new OAuthError('invalid_client_metadata', `token_endpoint_auth_method "${method}" non supportato.`);
  }
  const name = (typeof meta.client_name === 'string' ? meta.client_name : 'Assistente AI').trim().slice(0, 100) || 'Assistente AI';
  const uri = typeof meta.client_uri === 'string' && /^https:\/\//.test(meta.client_uri) ? meta.client_uri.slice(0, 300) : null;

  const id = `giro_${randomToken(16)}`;
  const secret = method === 'none' ? null : randomToken(32);
  const { error } = await db()
    .from('oauth_clients')
    .insert({ id, name, uri, redirect_uris: redirects, secret_hash: secret ? sha256(secret) : null });
  if (error) throw new OAuthError('server_error', `Registrazione non riuscita: ${error.message}`, 500);
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    ...(uri ? { client_uri: uri } : {}),
    redirect_uris: redirects,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  };
}

export async function getClient(id: string | null | undefined): Promise<OAuthClient | null> {
  if (!id) return null;
  const { data } = await db().from('oauth_clients').select('id, name, uri, redirect_uris, secret_hash').eq('id', id).maybeSingle();
  return (data as OAuthClient | null) ?? null;
}

/**
 * Il client che chiama /oauth/token o /oauth/revoke: id (e segreto, per i client confidenziali)
 * dal corpo della richiesta o dall'intestazione Authorization: Basic.
 */
export async function authenticateClient(form: FormData, header: string | null): Promise<OAuthClient> {
  let id = form.get('client_id')?.toString() ?? null;
  let secret = form.get('client_secret')?.toString() ?? null;
  if (header?.startsWith('Basic ')) {
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    id = decodeURIComponent(u ?? '');
    secret = decodeURIComponent(p ?? '');
  }
  const client = await getClient(id);
  if (!client) throw new OAuthError('invalid_client', 'Client sconosciuto.', 401);
  if (client.secret_hash && !(secret && safeEqual(sha256(secret), client.secret_hash))) {
    throw new OAuthError('invalid_client', 'Segreto del client mancante o sbagliato.', 401);
  }
  return client;
}

/** Dopo il sì della persona: un codice monouso, valido 10 minuti, legato a client, indirizzo, PKCE e risorsa. */
export async function createCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: Scope[];
  resource: string;
}): Promise<string> {
  const code = randomToken(32);
  const { error } = await db().from('oauth_codes').insert({
    code_hash: sha256(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource,
    expires_at: inSeconds(CODE_TTL_S),
  });
  if (error) throw new OAuthError('server_error', error.message, 500);
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function issue(): { access: string; refresh: string; row: Record<string, string> } {
  const access = randomToken(32);
  const refresh = randomToken(32);
  return {
    access,
    refresh,
    row: {
      access_hash: sha256(access),
      refresh_hash: sha256(refresh),
      access_expires_at: inSeconds(ACCESS_TTL_S),
      refresh_expires_at: inSeconds(REFRESH_TTL_S),
    },
  };
}

const response = (access: string, refresh: string, scopes: string[]): TokenResponse => ({
  access_token: access,
  token_type: 'Bearer',
  expires_in: ACCESS_TTL_S,
  refresh_token: refresh,
  scope: scopes.join(' '),
});

/** Scambio del codice (una volta sola) con i token. Un codice usato due volte revoca i token nati dal primo uso. */
export async function exchangeCode(client: OAuthClient, form: FormData): Promise<TokenResponse> {
  const code = form.get('code')?.toString() ?? '';
  const verifier = form.get('code_verifier')?.toString() ?? '';
  const redirectUri = form.get('redirect_uri')?.toString() ?? '';
  const admin = db();
  const { data: row } = await admin.from('oauth_codes').select('*').eq('code_hash', sha256(code)).maybeSingle();
  if (!row || row.client_id !== client.id) throw new OAuthError('invalid_grant', 'Codice non valido.');
  if (row.used_at) {
    // Riuso: qualcuno ha intercettato il codice. Si revoca quello che il primo uso ha dato.
    await admin.from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('client_id', client.id).eq('user_id', row.user_id).gte('created_at', row.used_at);
    throw new OAuthError('invalid_grant', 'Codice già usato.');
  }
  if (new Date(row.expires_at) < new Date()) throw new OAuthError('invalid_grant', 'Codice scaduto: ripeti l\'accesso.');
  if (row.redirect_uri !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri diverso da quello della richiesta.');
  if (!pkceMatches(verifier, row.code_challenge)) throw new OAuthError('invalid_grant', 'code_verifier non corrisponde (PKCE).');
  const resource = form.get('resource')?.toString();
  if (resource && resource.replace(/\/$/, '') !== String(row.resource).replace(/\/$/, '')) throw new OAuthError('invalid_target', 'Risorsa diversa da quella autorizzata.');

  // Segna il codice come usato prima di emettere i token: due richieste insieme non ottengono due coppie
  const { data: claimed } = await admin
    .from('oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', row.code_hash)
    .is('used_at', null)
    .select('code_hash');
  if (!claimed?.length) throw new OAuthError('invalid_grant', 'Codice già usato.');

  const { access, refresh, row: tokens } = issue();
  const { error } = await admin.from('oauth_tokens').insert({
    client_id: client.id,
    user_id: row.user_id,
    scopes: row.scopes,
    resource: row.resource,
    ...tokens,
  });
  if (error) throw new OAuthError('server_error', error.message, 500);
  return response(access, refresh, row.scopes);
}

/** Rinnovo: il token di rinnovo si usa una volta e ne arriva uno nuovo (rotazione). */
export async function refreshTokens(client: OAuthClient, form: FormData): Promise<TokenResponse> {
  const refreshToken = form.get('refresh_token')?.toString() ?? '';
  const admin = db();
  const { data: row } = await admin.from('oauth_tokens').select('*').eq('refresh_hash', sha256(refreshToken)).maybeSingle();
  if (!row || row.client_id !== client.id || row.revoked_at) throw new OAuthError('invalid_grant', 'Token di rinnovo non valido.');
  if (row.refresh_expires_at && new Date(row.refresh_expires_at) < new Date()) throw new OAuthError('invalid_grant', 'Token di rinnovo scaduto: ripeti l\'accesso.');
  // Si possono chiedere meno permessi, mai di più
  const asked = form.get('scope')?.toString().split(/\s+/).filter(Boolean);
  const scopes: string[] = asked?.length ? asked.filter((s) => (row.scopes as string[]).includes(s)) : row.scopes;
  if (!scopes.length) throw new OAuthError('invalid_scope', 'Permessi non concessi.');
  const { access, refresh, row: tokens } = issue();
  const { data: updated } = await admin
    .from('oauth_tokens')
    .update({ ...tokens, scopes })
    .eq('id', row.id)
    .eq('refresh_hash', row.refresh_hash)
    .select('id');
  if (!updated?.length) throw new OAuthError('invalid_grant', 'Token di rinnovo già usato.');
  return response(access, refresh, scopes);
}

export interface AccessGrant {
  userId: string;
  clientId: string;
  clientName: string;
  scopes: Scope[];
  expiresAt: number;
  resource: string;
}

/** Il token di accesso che arriva al server MCP: valido, non scaduto, non revocato, per questa risorsa. */
export async function verifyAccessToken(token: string, resource: string): Promise<AccessGrant | null> {
  if (!token) return null;
  const admin = adminClient();
  if (!admin) return null;
  const { data: row } = await admin
    .from('oauth_tokens')
    .select('id, user_id, client_id, scopes, resource, access_expires_at, revoked_at, last_used_at, client:oauth_clients(name)')
    .eq('access_hash', sha256(token))
    .maybeSingle();
  if (!row || row.revoked_at || new Date(row.access_expires_at) < new Date()) return null;
  if (String(row.resource).replace(/\/$/, '') !== resource.replace(/\/$/, '')) return null;
  // Account sospeso o cancellato: niente accesso
  const { data: profile } = await admin.from('profiles').select('suspended_at').eq('id', row.user_id).maybeSingle();
  if (!profile || profile.suspended_at) return null;
  // "Ultimo uso" per la pagina dell'account, al massimo una scrittura ogni 5 minuti
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 5 * 60_000) {
    void admin.from('oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => {});
  }
  return {
    userId: row.user_id,
    clientId: row.client_id,
    clientName: (row.client as unknown as { name: string } | null)?.name ?? 'Assistente AI',
    scopes: (row.scopes as string[]).filter((s): s is Scope => s in SCOPES),
    expiresAt: Math.floor(new Date(row.access_expires_at).getTime() / 1000),
    resource: row.resource,
  };
}

/** Revoca (RFC 7009): un token di accesso o di rinnovo chiude tutto l'accesso di quella coppia. */
export async function revokeToken(client: OAuthClient, token: string): Promise<void> {
  const hash = sha256(token);
  await db()
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', client.id)
    .or(`access_hash.eq.${hash},refresh_hash.eq.${hash}`);
}

export interface Connection {
  clientId: string;
  name: string;
  uri: string | null;
  scopes: string[];
  since: string;
  lastUsed: string | null;
}

/** Gli assistenti collegati a un account, per la pagina "I miei annunci". */
export async function connectionsOf(userId: string): Promise<Connection[]> {
  const admin = adminClient();
  if (!admin) return [];
  const { data } = await admin
    .from('oauth_tokens')
    .select('client_id, scopes, created_at, last_used_at, refresh_expires_at, client:oauth_clients(name, uri)')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  const now = Date.now();
  const byClient = new Map<string, Connection>();
  for (const row of data ?? []) {
    if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime() < now) continue;
    const client = row.client as unknown as { name: string; uri: string | null } | null;
    const known = byClient.get(row.client_id);
    const lastUsed = [known?.lastUsed, row.last_used_at].filter(Boolean).sort().at(-1) ?? null;
    byClient.set(row.client_id, {
      clientId: row.client_id,
      name: client?.name ?? 'Assistente AI',
      uri: client?.uri ?? null,
      scopes: [...new Set([...(known?.scopes ?? []), ...(row.scopes as string[])])],
      since: known ? (known.since < row.created_at ? known.since : row.created_at) : row.created_at,
      lastUsed,
    });
  }
  return [...byClient.values()];
}

/** Scollega un assistente: tutti i suoi token per questa persona smettono di valere subito. */
export async function disconnect(userId: string, clientId: string): Promise<void> {
  const { error } = await db().from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('user_id', userId).eq('client_id', clientId).is('revoked_at', null);
  if (error) throw new OAuthError('server_error', error.message, 500);
}
