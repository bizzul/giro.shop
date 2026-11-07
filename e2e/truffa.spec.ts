import { expect, test, type Page } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';

/**
 * Rischio truffa: chi riceve un messaggio sospetto vede l'avviso (chi lo scrive no),
 * e un annuncio a rischio compare in cima alla moderazione, dove si nasconde con un tocco.
 */
test.describe.configure({ mode: 'serial' });

const sellerEmail = testEmail('sospetto');
const buyerEmail = testEmail('prudente');
const modEmail = testEmail('moderatore');
let buyer: Page;
let seller: Page;
let listingId = '';
let sellerId = '';

test.beforeAll(async ({ browser, request }) => {
  const { data } = await admin.auth.admin.createUser({ email: sellerEmail, email_confirm: true, user_metadata: { display_name: 'Ugo' } });
  sellerId = data.user!.id;
  const { data: listing, error } = await admin
    .from('listings')
    .insert({
      seller_id: sellerId,
      status: 'pubblicato',
      title: 'Console di gioco nuova',
      description: 'Mai usata.',
      category_id: 'videogiochi',
      price_chf: 90,
      condition: 'nuovo',
      comune_id: 'lugano',
      published_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  listingId = listing.id;
  await admin.from('listing_photos').insert({ listing_id: listingId, storage_path: '/foto/l-010.webp', position: 0 });
  await admin.from('listing_risk').insert({ listing_id: listingId, score: 0.73, signals: ['anticipo'], reasons: ['Pagamento in anticipo o non tracciabile'] });
  await expect.poll(async () => (await request.get(`/annuncio/${listingId}`)).status(), { timeout: 20_000, intervals: [1_000] }).toBe(200);
  buyer = await (await browser.newContext()).newPage();
  await login(buyer, buyerEmail);
  seller = await (await browser.newContext()).newPage();
  await login(seller, sellerEmail);
});

test.afterAll(async () => {
  await buyer?.context().close();
  await seller?.context().close();
  await deleteUsers([sellerEmail, buyerEmail, modEmail]);
});

test('chi riceve un messaggio sospetto vede un avviso, chi lo manda no', async () => {
  await buyer.goto(`/annuncio/${listingId}`);
  await buyer.locator('form.contact-form textarea[name="body"]').fill('È disponibile?');
  await buyer.locator('form.contact-form').getByRole('button', { name: 'Invia' }).click();
  await buyer.waitForURL(/\/messaggi\/[^/]+/);
  const conversation = buyer.url();

  await seller.goto(conversation);
  await seller.locator('#body').fill('Sì. Per tenertela mi serve una caparra di 30 franchi, poi te la spedisco.');
  await seller.getByRole('button', { name: 'Invia' }).click();
  await expect(seller.locator('#thread')).toContainText('caparra');
  await expect(seller.locator('#thread .risk')).toHaveCount(0);

  await buyer.reload();
  await expect(buyer.locator('#thread .risk')).toContainText('pagamento in anticipo');
  await expect(buyer.locator('#thread .risk a')).toHaveAttribute('href', /\/segnala\?conversazione=/);
});

test('un annuncio a rischio si nasconde dalla moderazione', async ({ browser }) => {
  const { data } = await admin.auth.admin.createUser({ email: modEmail, email_confirm: true, user_metadata: { display_name: 'Moderatrice' } });
  await admin.from('profiles').update({ is_moderator: true }).eq('id', data.user!.id);
  const mod = await (await browser.newContext()).newPage();
  await login(mod, modEmail, '/moderazione');

  const card = mod.locator('#rischio li.panel', { hasText: 'Console di gioco nuova' });
  await expect(card).toContainText('Rischio 73%');
  await expect(card).toContainText('Pagamento in anticipo');
  await card.getByRole('button', { name: 'Nascondi' }).click();
  await expect(mod.locator('.notice')).toContainText('Annuncio nascosto');
  await expect(mod.locator('#rischio li.panel', { hasText: 'Console di gioco nuova' })).toHaveCount(0);

  const { data: listing } = await admin.from('listings').select('hidden_at').eq('id', listingId).single();
  expect(listing?.hidden_at).toBeTruthy();
  const { data: notes } = await admin.from('notifications').select('kind').eq('user_id', sellerId).eq('kind', 'segnalazione');
  expect(notes?.length).toBeGreaterThan(0);
  await mod.context().close();
});
