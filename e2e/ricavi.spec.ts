import { expect, test, type Browser, type Page } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';
import { hydrated } from './islands.ts';
import { listingIdFromParam } from '../src/core/seo.ts';

/**
 * Ricavi, con il pagamento di prova: vetrina mirata, pubblicazione a pagamento in Auto, negozio Pro
 * (pagina del negozio, prezzi in blocco a parole, import del catalogo), partner locali e pagamento protetto.
 */
test.describe.configure({ mode: 'serial' });

const sellerEmail = testEmail('negozio');
const buyerEmail = testEmail('cliente');
const searcherEmail = testEmail('cercatore');
const modEmail = testEmail('moderatrice');
const partnerName = `Sgomberi Prova ${Date.now().toString(36)}`;
let seller: Page;
let buyer: Page;
let sellerId = '';
let armchair = '';
let carId = '';

async function signedIn(browser: Browser, email: string, next = '/miei-annunci'): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email, next);
  return page;
}

test.beforeAll(async ({ browser, request }) => {
  const { data } = await admin.auth.admin.createUser({ email: sellerEmail, email_confirm: true, user_metadata: { display_name: 'Bottega Prova' } });
  sellerId = data.user!.id;
  const { data: searcher } = await admin.auth.admin.createUser({ email: searcherEmail, email_confirm: true, user_metadata: { display_name: 'Cerca' } });
  await admin.from('alerts').insert({ user_id: searcher.user!.id, query: 'poltrona', filters: {} });
  const { data: listing } = await admin
    .from('listings')
    .insert({
      seller_id: sellerId,
      status: 'pubblicato',
      title: 'Poltrona in pelle color cognac',
      description: 'Comoda, pelle morbida.',
      category_id: 'arredamento',
      price_chf: 120,
      condition: 'buono',
      comune_id: 'lugano',
    })
    .select('id')
    .single();
  armchair = listing!.id;
  await admin.from('listing_photos').insert({ listing_id: armchair, storage_path: '/foto/l-010.webp', position: 0 });
  await expect.poll(async () => (await request.get(`/annuncio/${armchair}`)).status(), { timeout: 20_000, intervals: [1_000] }).toBe(200);
  seller = await signedIn(browser, sellerEmail);
  buyer = await signedIn(browser, buyerEmail);
});

test.afterAll(async () => {
  await admin.from('partners').delete().eq('name', partnerName);
  for (const id of [carId]) {
    if (!id) continue;
    const { data: files } = await admin.storage.from('foto').list(`${sellerId}/${id}`);
    if (files?.length) await admin.storage.from('foto').remove(files.map((f) => `${sellerId}/${id}/${f.name}`));
  }
  await seller?.context().close();
  await buyer?.context().close();
  await deleteUsers([sellerEmail, buyerEmail, searcherEmail, modEmail]);
});

test('vetrina mirata: si paga, va in cima e chi lo cerca riceve un avviso', async () => {
  const row = seller.locator(`#a-${armchair}`);
  // Le ricerche salvate scritte direttamente nel database si leggono entro 20 secondi
  await expect(async () => {
    await seller.goto('/miei-annunci');
    await expect(row.locator('.vetrina')).toContainText('avvisa la persona che lo cerca', { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await row.locator('.vetrina').getByRole('button').click();
  await seller.waitForURL(/\/pagamento\//);
  await expect(seller.locator('main')).toContainText('Pagamento di prova');
  await seller.getByRole('button', { name: /Paga CHF 3/ }).click();
  await seller.waitForURL(/\/miei-annunci\?fatto=vetrina/);
  await expect(seller.locator('.notice')).toContainText('In vetrina per 7 giorni');
  await expect(seller.locator(`#a-${armchair} .vetrina`)).toContainText('In vetrina');

  const { data: notes } = await admin.from('notifications').select('title').eq('listing_id', armchair).eq('kind', 'ricerca');
  expect(notes?.some((n) => n.title.includes('poltrona'))).toBe(true);
  await seller.goto(`/annuncio/${armchair}`);
  await expect(seller.locator('.price-row')).toContainText('In vetrina');
});

test('auto: senza Pro la pubblicazione si paga, poi va in vendita', async () => {
  await seller.goto('/vendi');
  await hydrated(seller, 'SellForm');
  await seller.locator('input[type="file"]').first().setInputFiles('public/foto/l-010.webp');
  await expect(seller.locator('.ph-grid img, .photos img').first()).toBeVisible();
  await seller.getByLabel('Due righe, se vuoi').fill("Auto Fiat Panda del 2015, 90'000 km");
  await seller.locator('#comune').fill('Lugano');
  await seller.getByRole('option', { name: /^Lugano/ }).click();
  await seller.getByRole('button', { name: 'Prepara la bozza' }).click();
  await seller.locator('#draft-price').fill('4500');
  await seller.getByRole('button', { name: 'Pubblica annuncio' }).click();
  await seller.waitForURL(/\/pagamento\//);
  await expect(seller.locator('main')).toContainText('Pubblicazione per 90 giorni');
  await seller.getByRole('button', { name: /Paga CHF 9\.90/ }).click();
  await seller.waitForURL(/\/annuncio\//);
  carId = listingIdFromParam(new URL(seller.url()).pathname.split('/').pop()!);
  const { data } = await admin.from('listings').select('status, category_id').eq('id', carId).single();
  expect(data).toEqual({ status: 'pubblicato', category_id: 'auto' });
});

test('Pro: si attiva, il negozio ha la sua pagina, i prezzi cambiano a parole e il catalogo si importa', async () => {
  await seller.goto('/pro');
  await seller.locator('form.plan', { hasText: 'Un anno' }).getByRole('button', { name: 'Attiva Pro' }).click();
  await seller.waitForURL(/\/pagamento\//);
  await seller.getByRole('button', { name: /Paga CHF 119\.88/ }).click();
  await seller.waitForURL(/\/pro\?fatto=attivo/);
  await expect(seller.locator('.notice')).toContainText('Pro attivo');

  await seller.locator('input[name="name"]').fill('Bottega del Ticino');
  await seller.locator('input[name="address"]').fill('Via Nassa 1, Lugano');
  await seller.getByRole('button', { name: 'Salva il negozio' }).click();
  await expect(seller.locator('.notice')).toContainText('Negozio salvato');
  await seller.goto(`/venditore/${sellerId}`);
  await expect(seller.getByRole('heading', { level: 1 })).toHaveText('Bottega del Ticino');
  await expect(seller.locator('.shop')).toContainText('Via Nassa 1');

  await seller.goto('/pro#blocco');
  await seller.locator('#phrase').fill('tutte le auto −10% per 3 giorni');
  await seller.getByRole('button', { name: 'Vedi cosa cambia' }).click();
  await expect(seller.locator('.changes')).toContainText("CHF 4'500.– → CHF 4'050.–");
  await seller.getByRole('button', { name: 'Conferma' }).click();
  await expect(seller.locator('.notice')).toContainText('Prezzi cambiati su 1 annunci');
  const { data: car } = await admin.from('listings').select('price_chf').eq('id', carId).single();
  expect(Number(car?.price_chf)).toBe(4050);

  await seller.locator('textarea[name="csv"]').fill('titolo;prezzo;comune\nSedia impagliata di prova;20;Lugano\nTavolo in noce di prova;80;Bellinzona');
  await seller.getByRole('button', { name: 'Controlla il file' }).click();
  await expect(seller.locator('#catalogo')).toContainText('2 oggetti pronti');
  await seller.getByRole('button', { name: 'Importa 2 oggetti' }).click();
  await expect(seller.locator('.notice')).toContainText('2 in bozza');
});

test('partner: la ditta si candida, chi modera la accende, chi svuota casa chiede un preventivo', async ({ browser }) => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto('/partner');
  await anon.getByText('Diventa partner').click();
  await anon.locator('#diventa input[name="name"]').fill(partnerName);
  await anon.locator('#diventa select[name="service"]').selectOption('sgombero');
  await anon.locator('#diventa input[name="district"][value="Lugano"]').check();
  await anon.locator('#diventa input[name="email"]').fill('ditta@esempio.test');
  await anon.getByRole('button', { name: 'Mandaci la richiesta' }).click();
  await expect(anon.locator('.notice')).toContainText('Richiesta ricevuta');

  const { data } = await admin.auth.admin.createUser({ email: modEmail, email_confirm: true, user_metadata: { display_name: 'Moderatrice' } });
  await admin.from('profiles').update({ is_moderator: true }).eq('id', data.user!.id);
  const mod = await signedIn(browser, modEmail, '/moderazione');
  const card = mod.locator('#partner li', { hasText: partnerName });
  await card.getByRole('button', { name: 'Attiva' }).click();
  await expect(mod.locator('.notice')).toContainText('Partner acceso');
  await mod.context().close();

  await expect(async () => {
    await anon.goto('/partner?servizio=sgombero&zona=Lugano');
    await expect(anon.locator('.card', { hasText: partnerName })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  const partner = anon.locator('.card', { hasText: partnerName });
  await partner.getByText('Chiedi un preventivo').click();
  await partner.locator('input[name="name"]').fill('Luca');
  await partner.locator('input[name="contact"]').fill('079 123 45 67');
  await partner.locator('textarea[name="message"]').fill('Cantina da svuotare a Lugano, una ventina di scatoloni.');
  await partner.locator('input[name="consent"]').check();
  await partner.getByRole('button', { name: 'Invia la richiesta' }).click();
  await expect(anon.locator('.notice')).toContainText('Richiesta inviata');
  const { data: p } = await admin.from('partners').select('id').eq('name', partnerName).single();
  const { data: leads } = await admin.from('partner_leads').select('name, fee_chf').eq('partner_id', p!.id);
  expect(leads).toEqual([{ name: 'Luca', fee_chf: 5 }]);
  await anon.context().close();
});

test('pagamento protetto: chi compra paga, i soldi restano fermi, alla consegna vanno a chi vende', async () => {
  await buyer.goto(`/annuncio/${armchair}`);
  await buyer.locator('form.contact-form').getByRole('button', { name: 'Invia' }).click();
  await buyer.waitForURL(/\/messaggi\/[^/]+/);
  const conversation = buyer.url().split('#')[0];
  await buyer.getByRole('button', { name: /Paga protetto/ }).click();
  await buyer.waitForURL(/\/pagamento\//);
  await expect(buyer.locator('main')).toContainText('Commissione del pagamento protetto');
  await buyer.getByRole('button', { name: /Paga CHF 126\.50/ }).click();
  await buyer.waitForURL(/\/messaggi\//);
  await expect(buyer.locator('.protected')).toContainText('Hai pagato CHF 120');
  await expect(buyer.locator('#thread')).toContainText('trattenuti da giro.shop');

  await seller.goto(conversation);
  await expect(seller.locator('.protected')).toContainText('trattenuti per te');

  await buyer.getByRole('button', { name: "Ho ricevuto l'oggetto, va tutto bene" }).click();
  await expect(buyer.locator('#thread')).toContainText('Consegna confermata');
  const { data: listing } = await admin.from('listings').select('status, sold_price_chf').eq('id', armchair).single();
  expect(listing?.status).toBe('venduto');
  expect(Number(listing?.sold_price_chf)).toBe(120);
  const { data: payments } = await admin.from('payments').select('status, fee_chf').eq('listing_id', armchair).eq('kind', 'protetto');
  expect(payments?.map((p) => [p.status, Number(p.fee_chf)])).toEqual([['rilasciato', 6.5]]);
});
