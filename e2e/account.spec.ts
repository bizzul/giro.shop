import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';

/** Un solo accesso per tutti i test di questo file: si va in ordine, nella stessa pagina. */
test.describe.configure({ mode: 'serial' });

const email = testEmail('account');
const clients: string[] = [];
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, email);
});

test.afterAll(async () => {
  await page?.close();
  if (clients.length) await admin.from('oauth_clients').delete().in('id', clients);
  await deleteUsers([email]);
});

test('accesso con il link via email', async () => {
  await expect(page).toHaveURL(/\/miei-annunci/);
  await expect(page.getByRole('heading', { name: 'Email degli avvisi' })).toBeVisible();
});

test('salvare una ricerca dai risultati', async () => {
  const q = 'bici da corsa sotto i 900 franchi';
  await page.goto(`/cerca?q=${encodeURIComponent(q)}`);
  await page.getByRole('link', { name: 'Avvisami per i prossimi' }).click();
  await page.getByRole('button', { name: 'Avvisami' }).click();
  await expect(page).toHaveURL(/\/salvati\?fatto=ricerca/);
  await expect(page.locator('#ricerche')).toContainText(q);
});

test('email degli avvisi: si salva da sola, con una notifica', async () => {
  await page.goto('/miei-annunci#email');
  await page.getByLabel('Un riassunto al giorno, alle 18').check();
  await expect(page.getByRole('status').filter({ hasText: 'un riassunto al giorno' })).toBeVisible();
  await page.getByLabel('Valutazioni che ricevi').uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'Salvato' }).last()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Un riassunto al giorno, alle 18')).toBeChecked();
  await expect(page.getByLabel('Valutazioni che ricevi')).not.toBeChecked();
  await expect(page.getByLabel('Annunci tuoi in scadenza')).toBeChecked();
});

test('collegare un assistente AI: annullare, consentire, scollegare', async () => {
  const redirect = 'http://localhost:9999/callback';
  const reg = await (
    await page.request.post('/oauth/register', { data: { client_name: 'Assistente E2E', redirect_uris: [redirect] } })
  ).json();
  clients.push(reg.client_id);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'ricerche annunci' })}`;

  // L'assistente non è in ascolto: si intercetta il ritorno e si legge l'indirizzo
  let back: URL | null = null;
  await page.route('http://localhost:9999/**', (route) => {
    back = new URL(route.request().url());
    return route.fulfill({ body: 'ok' });
  });

  await page.goto(authorize);
  await expect(page.getByRole('heading', { name: /Collegare .?Assistente E2E.? al tuo account\?/ })).toBeVisible();
  await expect(page.getByText('Pubblicare annunci a tuo nome')).toBeVisible();
  await page.getByRole('button', { name: 'Annulla' }).click();
  await expect.poll(() => back?.searchParams.get('error')).toBe('access_denied');
  expect(back!.searchParams.get('state')).toBe('xyz');

  back = null;
  await page.goto(authorize);
  await page.getByRole('button', { name: 'Consenti' }).click();
  await expect.poll(() => back?.searchParams.get('code')).toBeTruthy();
  expect(back!.searchParams.get('iss')).toBe('http://localhost:4321');

  const token = await page.request.post('/oauth/token', {
    form: { grant_type: 'authorization_code', code: back!.searchParams.get('code')!, code_verifier: verifier, redirect_uri: redirect, client_id: reg.client_id },
  });
  expect(token.ok()).toBe(true);

  await page.goto('/miei-annunci#assistenti');
  const panel = page.locator('#assistenti');
  await expect(panel).toContainText('Assistente E2E');
  await panel.getByRole('button', { name: 'Scollega' }).click();
  await expect(page.locator('#assistenti')).toContainText('Nessuno.');
});
