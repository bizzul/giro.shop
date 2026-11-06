/**
 * Verifica l'accesso OAuth del connettore AI con il client MCP ufficiale, come farebbe Claude:
 * scoperta (401 + metadati), registrazione dinamica, PKCE, scambio del codice, strumenti dell'account,
 * rinnovo con rotazione, riuso del codice, revoca, account sospeso.
 * Il passaggio nel browser (accesso + "Consenti") è simulato creando il codice come fa la pagina di consenso.
 * Uso: pnpm test:oauth   (con `supabase start` e il server di sviluppo acceso)
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client, StreamableHTTPClientTransport, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/client';

const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' }));
process.env.PUBLIC_SUPABASE_URL = status.API_URL;
process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY;
const { createCode } = await import('../src/lib/oauth.ts');
const { parseScopes } = await import('../src/core/oauth.ts');

const BASE = process.argv[2] ?? 'http://localhost:4321';
const MCP = new URL('/mcp/account', BASE);
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const expect = (check: string, ok: boolean, detail?: string) => results.push({ check, ok, detail });
const tag = Math.random().toString(36).slice(2, 8);
const users: string[] = [];
const clients: string[] = [];

async function makeUser(name: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email: `${name}-${tag}@esempio.test`, email_confirm: true, user_metadata: { display_name: name } });
  if (error || !data.user) throw new Error(`creazione ${name}: ${error?.message}`);
  users.push(data.user.id);
  return data.user.id;
}

/** Un client MCP con OAuth in memoria. Il "browser" crea il codice per `userId`, come la pagina di consenso. */
class TestProvider implements OAuthClientProvider {
  info?: { client_id: string; client_secret?: string };
  saved?: { access_token: string; refresh_token?: string; token_type: string };
  verifier = '';
  code = '';
  authorizeUrl?: URL;
  private userId: string;
  constructor(userId: string) {
    this.userId = userId;
  }
  get redirectUrl() {
    return 'http://localhost:9999/callback';
  }
  get clientMetadata() {
    return { client_name: `Prova OAuth ${tag}`, redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: { client_id: string }) {
    this.info = info;
    clients.push(info.client_id);
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: { access_token: string; refresh_token?: string; token_type: string }) {
    this.saved = tokens;
  }
  async redirectToAuthorization(url: URL) {
    this.authorizeUrl = url;
    this.code = await createCode({
      clientId: url.searchParams.get('client_id')!,
      userId: this.userId,
      redirectUri: url.searchParams.get('redirect_uri')!,
      codeChallenge: url.searchParams.get('code_challenge')!,
      scopes: parseScopes(url.searchParams.get('scope')),
      resource: url.searchParams.get('resource') ?? MCP.href,
    });
  }
  discovery?: unknown;
  saveDiscoveryState(state: unknown) {
    this.discovery = state;
  }
  discoveryState() {
    return this.discovery as never;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const body = (r: unknown) => (r as ToolResult).content.find((c) => c.type === 'text')?.text ?? '';
const json = (r: unknown) => {
  try {
    return JSON.parse(body(r));
  } catch {
    return {};
  }
};

async function connect(provider: TestProvider): Promise<Client> {
  const client = new Client({ name: 'check-oauth', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(MCP, { authProvider: provider });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    // Come il redirect della pagina di consenso: codice e iss (RFC 9207)
    await transport.finishAuth(new URLSearchParams({ code: provider.code, iss: new URL(BASE).origin }));
    const again = new Client({ name: 'check-oauth', version: '1.0.0' });
    await again.connect(new StreamableHTTPClientTransport(MCP, { authProvider: provider }));
    return again;
  }
}

const tokenRequest = (params: Record<string, string>) =>
  fetch(new URL('/oauth/token', BASE), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });

try {
  // Scoperta
  const unauth = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect('senza token: 401 con i metadati della risorsa', unauth.status === 401 && (unauth.headers.get('www-authenticate') ?? '').includes('/.well-known/oauth-protected-resource/mcp/account'));
  const asMeta = await (await fetch(new URL('/.well-known/oauth-authorization-server', BASE))).json();
  expect('metadati del server: PKCE S256 e registrazione', asMeta.code_challenge_methods_supported?.includes('S256') && Boolean(asMeta.registration_endpoint));

  // Registrazione: indirizzi di ritorno pericolosi rifiutati
  const bad = await fetch(new URL('/oauth/register', BASE), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
  expect('registrazione con http non locale rifiutata', bad.status === 400);
  const js = await fetch(new URL('/oauth/register', BASE), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) });
  expect('registrazione con javascript: rifiutata', js.status === 400);

  // Flusso completo con il client ufficiale
  const me = await makeUser('oauth');
  const other = await makeUser('altro');
  const provider = new TestProvider(me);
  const client = await connect(provider);
  expect('il client chiede PKCE S256 e la risorsa giusta', provider.authorizeUrl?.searchParams.get('code_challenge_method') === 'S256' && provider.authorizeUrl?.searchParams.get('resource') === MCP.href, provider.authorizeUrl?.href);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  expect('con l\'accesso ci sono gli strumenti dell\'account', ['publish_listing', 'my_listings', 'update_listing', 'save_search', 'my_saved_searches', 'search_listings'].every((n) => names.includes(n)), names.join(', '));

  const saved = json(await client.callTool({ name: 'save_search', arguments: { query: `divano grigio ${tag}` } }));
  const { data: alert } = await admin.from('alerts').select('user_id').eq('id', saved.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle();
  expect('save_search salva nell\'account di chi ha dato il permesso', saved.saved === true && alert?.user_id === me);
  const list = json(await client.callTool({ name: 'my_saved_searches', arguments: {} }));
  expect('my_saved_searches la vede', list.searches?.some((s: { id: string }) => s.id === saved.id));

  const draft = json(await client.callTool({ name: 'publish_listing', arguments: { title: `Divano prova ${tag}`, description: 'Prova del connettore', category: 'arredamento', condition: 'buono', price_chf: 120, comune: 'Lugano' } }));
  const { data: draftRow } = await admin.from('listings').select('seller_id, status').eq('id', draft.id ?? '').maybeSingle();
  expect('senza foto l\'annuncio resta in bozza, a nome della persona', draft.status === 'bozza' && draftRow?.seller_id === me && draftRow?.status === 'bozza', JSON.stringify(draft));

  const local = await client.callTool({ name: 'publish_listing', arguments: { title: 'Prova rete interna', description: '', category: 'altro', condition: 'buono', price_chf: 1, comune: 'Lugano', photo_urls: ['https://127.0.0.1/foto.jpg'] } });
  expect('foto da indirizzi interni rifiutate', Boolean((local as ToolResult).isError) && body(local).includes('non ammesso'), body(local));
  const plain = await client.callTool({ name: 'publish_listing', arguments: { title: 'Prova http', description: '', category: 'altro', condition: 'buono', price_chf: 1, comune: 'Lugano', photo_urls: ['http://example.com/foto.jpg'] } });
  expect('foto solo via https', Boolean((plain as ToolResult).isError) && body(plain).includes('https'), body(plain));

  const { data: theirs } = await admin
    .from('listings')
    .insert({ seller_id: other, status: 'pubblicato', title: `Annuncio di altri ${tag}`, description: '', category_id: 'altro', price_chf: 50, condition: 'buono', comune_id: 'lugano' })
    .select('id')
    .single();
  const steal = await client.callTool({ name: 'update_listing', arguments: { id: theirs!.id, price_chf: 1 } });
  const { data: theirsAfter } = await admin.from('listings').select('price_chf').eq('id', theirs!.id).single();
  expect('non si modificano gli annunci di altri', Boolean((steal as ToolResult).isError) && Number(theirsAfter?.price_chf) === 50);
  const noPhoto = await client.callTool({ name: 'update_listing', arguments: { id: draft.id, status: 'pubblicato' } });
  expect('una bozza senza foto non si pubblica', Boolean((noPhoto as ToolResult).isError) && body(noPhoto).includes('foto'));
  const priced = json(await client.callTool({ name: 'update_listing', arguments: { id: draft.id, price_chf: 99 } }));
  const { data: pricedRow } = await admin.from('listings').select('price_chf').eq('id', draft.id).single();
  expect('update_listing cambia il prezzo dei propri annunci', priced.updated === true && Number(pricedRow?.price_chf) === 99);
  const mine = json(await client.callTool({ name: 'my_listings', arguments: {} }));
  expect('my_listings mostra solo i propri', mine.listings?.length === 1 && mine.listings[0].id === draft.id);
  await client.close();

  // Rinnovo con rotazione
  const firstRefresh = provider.saved!.refresh_token!;
  const renewed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: firstRefresh, client_id: provider.info!.client_id });
  const renewedBody = await renewed.json();
  expect('il rinnovo dà nuovi token', renewed.ok && Boolean(renewedBody.access_token) && renewedBody.refresh_token !== firstRefresh);
  const replay = await tokenRequest({ grant_type: 'refresh_token', refresh_token: firstRefresh, client_id: provider.info!.client_id });
  expect('un token di rinnovo vale una volta sola', replay.status === 400 && (await replay.json()).error === 'invalid_grant');

  // Codice: PKCE sbagliato, riuso
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const code = await createCode({ clientId: provider.info!.client_id, userId: me, redirectUri: provider.redirectUrl, codeChallenge: challenge, scopes: ['ricerche'], resource: MCP.href });
  const wrong = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: randomBytes(32).toString('base64url'), redirect_uri: provider.redirectUrl, client_id: provider.info!.client_id });
  expect('PKCE sbagliato: niente token', wrong.status === 400);
  const code2 = await createCode({ clientId: provider.info!.client_id, userId: me, redirectUri: provider.redirectUrl, codeChallenge: challenge, scopes: ['ricerche'], resource: MCP.href });
  const ok = await tokenRequest({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: provider.redirectUrl, client_id: provider.info!.client_id });
  const okBody = await ok.json();
  const again = await tokenRequest({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: provider.redirectUrl, client_id: provider.info!.client_id });
  const afterReuse = await fetch(MCP, { method: 'POST', headers: { Authorization: `Bearer ${okBody.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect('un codice usato due volte revoca i token del primo uso', ok.ok && again.status === 400 && afterReuse.status === 401);

  // Permessi: solo "ricerche" → niente annunci
  const code3 = await createCode({ clientId: provider.info!.client_id, userId: me, redirectUri: provider.redirectUrl, codeChallenge: challenge, scopes: ['ricerche'], resource: MCP.href });
  const narrow = await (await tokenRequest({ grant_type: 'authorization_code', code: code3, code_verifier: verifier, redirect_uri: provider.redirectUrl, client_id: provider.info!.client_id })).json();
  const narrowClient = new Client({ name: 'check-oauth', version: '1.0.0' });
  await narrowClient.connect(new StreamableHTTPClientTransport(MCP, { requestInit: { headers: { Authorization: `Bearer ${narrow.access_token}` } } }));
  const denied = await narrowClient.callTool({ name: 'publish_listing', arguments: { title: 'Senza permesso', description: '', category: 'altro', condition: 'buono', price_chf: 1, comune: 'Lugano' } });
  expect('senza il permesso "annunci" non si pubblica', Boolean((denied as ToolResult).isError) && body(denied).includes('annunci'));
  await narrowClient.close();

  // Revoca e sospensione
  const revoke = await fetch(new URL('/oauth/revoke', BASE), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: renewedBody.access_token, client_id: provider.info!.client_id }) });
  const afterRevoke = await fetch(MCP, { method: 'POST', headers: { Authorization: `Bearer ${renewedBody.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect('dopo la revoca il token non vale più', revoke.ok && afterRevoke.status === 401 && (afterRevoke.headers.get('www-authenticate') ?? '').includes('invalid_token'));
  await admin.from('profiles').update({ suspended_at: new Date().toISOString(), suspended_reason: 'prova' }).eq('id', me);
  const suspendedCall = await fetch(MCP, { method: 'POST', headers: { Authorization: `Bearer ${narrow.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect('un account sospeso perde l\'accesso', suspendedCall.status === 401);

  // Pagina di consenso
  const unknown = await fetch(new URL('/oauth/authorize?client_id=sconosciuto&response_type=code', BASE), { redirect: 'manual' });
  expect('client sconosciuto: errore nella pagina, nessun redirect', unknown.status === 200 && (await unknown.text()).includes('Collegamento non valido'));
  const login = await fetch(new URL(`/oauth/authorize?client_id=${provider.info!.client_id}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&redirect_uri=${encodeURIComponent(provider.redirectUrl)}`, BASE), { redirect: 'manual' });
  expect('senza accesso si passa da /accedi e poi si torna', login.status === 303 && (login.headers.get('location') ?? '').startsWith('/accedi?next=%2Foauth%2Fauthorize'));
  const noPkce = await fetch(new URL(`/oauth/authorize?client_id=${provider.info!.client_id}&response_type=code&redirect_uri=${encodeURIComponent(provider.redirectUrl)}&state=s1`, BASE), { redirect: 'manual' });
  const noPkceTo = new URL(noPkce.headers.get('location') ?? 'http://x');
  expect('senza PKCE: errore rimandato al client con lo state', noPkce.status === 303 && noPkceTo.searchParams.get('error') === 'invalid_request' && noPkceTo.searchParams.get('state') === 's1');
} catch (error) {
  expect('esecuzione', false, (error as Error).stack ?? String(error));
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  if (clients.length) await admin.from('oauth_clients').delete().in('id', clients);
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.check}${!r.ok && r.detail ? `\n    ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} controlli superati; utenti e client temporanei cancellati.`);
process.exit(failed.length ? 1 : 0);
