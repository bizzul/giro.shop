import { expect, test, type Page } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';

/**
 * Assistente venditore (senza chiave di Claude: con le regole):
 * chi compra chiede se è disponibile e quando passare, con un'offerta sotto il minimo;
 * l'assistente risponde a nome di chi vende, rifiuta l'offerta e propone il primo orario libero.
 */
test.describe.configure({ mode: 'serial' });

const sellerEmail = testEmail('assistito');
const buyerEmail = testEmail('curioso');
let buyer: Page;
let listingId = '';

test.beforeAll(async ({ browser, request }) => {
  const { data } = await admin.auth.admin.createUser({ email: sellerEmail, email_confirm: true, user_metadata: { display_name: 'Marta' } });
  const sellerId = data.user!.id;
  const { data: listing, error } = await admin
    .from('listings')
    .insert({
      seller_id: sellerId,
      status: 'pubblicato',
      title: 'Poltrona in velluto verde',
      description: 'Poltrona comoda, velluto senza strappi.',
      category_id: 'arredamento',
      price_chf: 380,
      negotiable: true,
      condition: 'buono',
      comune_id: 'lugano',
      published_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  listingId = listing.id;
  await admin.from('listing_photos').insert({ listing_id: listingId, storage_path: '/foto/l-010.webp', position: 0 });
  await admin.from('seller_settings').insert({ user_id: sellerId, assistant_on: true, availability: ['sab-mattina', 'sere'] });
  await admin.from('listing_settings').insert({ listing_id: listingId, seller_id: sellerId, min_offer_chf: 300 });
  // Il server rilegge gli annunci al massimo ogni 10 secondi
  await expect.poll(async () => (await request.get(`/annuncio/${listingId}`)).status(), { timeout: 20_000, intervals: [1_000] }).toBe(200);
  buyer = await (await browser.newContext()).newPage();
  await login(buyer, buyerEmail);
});

test.afterAll(async () => {
  await buyer?.context().close();
  await deleteUsers([sellerEmail, buyerEmail]);
});

test("l'assistente risponde, rifiuta l'offerta troppo bassa e propone il ritiro", async () => {
  await buyer.goto(`/annuncio/${listingId}`);
  const form = buyer.locator('form.contact-form');
  await form.locator('textarea[name="body"]').fill('Ciao, è ancora disponibile? Quando posso passare a vederla?');
  await form.getByLabel('Offerta, se vuoi').fill('200');
  await form.getByRole('button', { name: 'Invia' }).click();
  await buyer.waitForURL(/\/messaggi\/[^/]+/);

  const thread = buyer.locator('#thread');
  await expect(async () => {
    await buyer.reload();
    await expect(thread).toContainText("Risposta automatica dell'assistente di Marta", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(thread).toContainText('Sì, è ancora disponibile.');
  await expect(thread).toContainText('troppo bassa per Marta');
  await expect(thread).toContainText('Rifiutata');
  await expect(thread).toContainText('Ritiro proposto da Marta');
  await expect(thread).not.toContainText('300');

  // Chi compra accetta l'orario proposto con un tocco
  await thread.getByRole('button', { name: 'Accetta' }).click();
  await expect(buyer.locator('.pickup-set')).toContainText('Ritiro fissato');
});
