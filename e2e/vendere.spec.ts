import { expect, test, type Browser, type Page } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';
import { zurichDay } from '../src/core/pickup.ts';
import { hydrated } from './islands.ts';

/**
 * Vendere e trattare, con due persone vere (due browser separati, ognuno con il suo accesso via email):
 * chi vende pubblica con "Scatta e vendi", chi aveva salvato «sofà» riceve l'avviso (per significato),
 * chi compra scrive con un'offerta, chi vende la accetta, si fissa il ritiro e dopo il ritiro chi vende conferma la vendita.
 */
test.describe.configure({ mode: 'serial' });

const sellerEmail = testEmail('vende');
const buyerEmail = testEmail('compra');
const watcherEmail = testEmail('avviso');
// Titolo realistico: un codice a caso nel titolo abbassa la somiglianza con «sofà» sotto la soglia degli avvisi
const title = 'Divano angolare grigio';
let seller: Page;
let buyer: Page;
let watcherId = '';
let listingId = '';

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}

test.beforeAll(async ({ browser, request }) => {
  // Chi aspetta un «sofà»: ricerca salvata senza la parola «divano»
  const { data } = await admin.auth.admin.createUser({ email: watcherEmail, email_confirm: true, user_metadata: { display_name: 'Avviso' } });
  watcherId = data.user!.id;
  await admin.from('alerts').insert({ user_id: watcherId, query: 'sofà', filters: {} });
  // Il modello della ricerca per significato si carica al primo uso
  await expect
    .poll(async () => (await (await request.get(`/risultati?q=${encodeURIComponent('sofà')}&vista=cerca`)).text()).includes('stesso significato'), { timeout: 60_000, intervals: [2_000] })
    .toBe(true);
  seller = await signedIn(browser, sellerEmail);
  buyer = await signedIn(browser, buyerEmail);
});

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return;
  if (listingId) {
    const { data: owner } = await admin.from('listings').select('seller_id').eq('id', listingId).maybeSingle();
    const folder = `${owner?.seller_id}/${listingId}`;
    const { data: files } = await admin.storage.from('foto').list(folder);
    if (files?.length) await admin.storage.from('foto').remove(files.map((f) => `${folder}/${f.name}`));
  }
  await seller?.context().close();
  await buyer?.context().close();
  await deleteUsers([sellerEmail, buyerEmail, watcherEmail]);
});

test('Scatta e vendi: foto, bozza, pubblicazione', async () => {
  await seller.goto('/vendi');
  await hydrated(seller, 'SellForm');
  await seller.locator('input[type="file"]').first().setInputFiles('public/foto/l-010.webp');
  await expect(seller.locator('.ph-grid img, .photos img').first()).toBeVisible();
  await seller.getByLabel('Due righe, se vuoi').fill('Divano angolare grigio, tre posti, sfoderabile, pochi segni d\'uso');
  await seller.locator('#comune').fill('Lugano');
  await seller.getByRole('option', { name: /^Lugano/ }).click();
  await seller.getByRole('button', { name: 'Prepara la bozza' }).click();

  await seller.locator('#draft-title').fill(title);
  await seller.locator('#draft-price').fill('320');
  await seller.getByRole('button', { name: 'Pubblica annuncio' }).click();
  await seller.waitForURL(/\/annuncio\//);
  listingId = new URL(seller.url()).pathname.split('/').pop()!;
  await expect(seller.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(seller.locator('.price, [data-price]').first()).toContainText('320');

  // Accanto alla foto c'è la miniatura WebP, ed è quella che usano le schede degli elenchi
  const { data: photo } = await admin.from('listing_photos').select('small_path, width, height').eq('listing_id', listingId).single();
  expect(photo?.small_path).toMatch(/-sm\.webp$/);
  expect(photo?.width).toBeGreaterThan(0);
  const small = await seller.request.get(admin.storage.from('foto').getPublicUrl(photo!.small_path!).data.publicUrl);
  expect(small.headers()['content-type']).toBe('image/webp');
  await seller.goto(`/cerca?q=${encodeURIComponent(title)}`);
  await expect(seller.locator('.lcard', { hasText: title }).locator('img')).toHaveAttribute('src', /-sm\.webp$/);
});

test('chi aveva salvato «sofà» riceve l\'avviso del divano', async () => {
  await expect
    .poll(
      async () => {
        const { data } = await admin.from('notifications').select('kind').eq('user_id', watcherId).eq('listing_id', listingId);
        return data?.some((n) => n.kind === 'ricerca') ?? false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});

test('chi compra scrive con un\'offerta', async () => {
  await buyer.goto(`/annuncio/${listingId}`);
  const form = buyer.locator('form.contact-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Offerta, se vuoi').fill('280');
  await form.getByRole('button', { name: 'Invia' }).click();
  await buyer.waitForURL(/\/messaggi\/[^/]+/);
  await expect(buyer.locator('#thread')).toContainText('Ciao, è ancora disponibile?');
  await expect(buyer.locator('#thread')).toContainText('In attesa di risposta');
});

test('chi vende accetta l\'offerta e lo vedono entrambi', async () => {
  await seller.goto('/messaggi');
  await seller.locator(`a[href^="/messaggi/"]`, { hasText: title }).first().click();
  await seller.waitForURL(/\/messaggi\/[^/]+/);
  await seller.getByRole('button', { name: 'Accetta' }).click();
  await expect(seller.locator('#thread')).toContainText('Accettata');
  await buyer.reload();
  await expect(buyer.locator('#thread')).toContainText('Accettata');
});

test('chi compra propone il ritiro, chi vende lo conferma', async () => {
  const day = zurichDay(new Date(Date.now() + 2 * 864e5));
  await buyer.getByText('Proponi giorno e ora del ritiro').click();
  await buyer.locator('input[name="pickupDay"]').fill(day);
  await buyer.locator('input[name="pickupTime"]').fill('10:00');
  await buyer.locator('input[name="pickupPlace"]').fill('Lugano, stazione');
  await buyer.getByRole('button', { name: 'Invia' }).click();
  await expect(buyer.locator('#thread')).toContainText('Il ritiro che proponi');
  await expect(buyer.locator('#thread')).toContainText('alle 10:00 · Lugano, stazione');

  await seller.reload();
  await expect(seller.locator('#thread')).toContainText('Ritiro proposto da');
  await seller.getByRole('button', { name: 'Accetta' }).click();
  await expect(seller.locator('.pickup-set')).toContainText('Ritiro fissato');
  await expect(seller.locator('.pickup-set')).toContainText('Lugano, stazione');
  await buyer.reload();
  await expect(buyer.locator('#thread')).toContainText('Ritiro confermato.');
});

test('dopo il ritiro chi vende conferma la vendita con un tocco', async () => {
  // Il ritiro è passato da tre ore
  await admin.from('conversations').update({ pickup_at: new Date(Date.now() - 3 * 36e5).toISOString() }).eq('listing_id', listingId);
  await seller.goto('/miei-annunci');
  const row = seller.locator(`#a-${listingId}`);
  await expect(row).toContainText("com'è andato?");
  await expect(row.locator('.stats').first()).toContainText('1 contatto');
  await row.getByRole('button', { name: /Sì, venduto a CHF 280/ }).click();
  await expect(seller.locator(`#a-${listingId}`)).toContainText('Venduto');
  const { data } = await admin.from('listings').select('status, sold_price_chf').eq('id', listingId).single();
  expect(data?.status).toBe('venduto');
  expect(Number(data?.sold_price_chf)).toBe(280);
  const { data: conv } = await admin.from('conversations').select('pickup_outcome').eq('listing_id', listingId).single();
  expect(conv?.pickup_outcome).toBe('venduto');
});
