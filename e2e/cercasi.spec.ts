import { expect, test } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';

/**
 * "Lo cercano in 4" e Cercasi: tre persone cercano una bici da corsa;
 * la pagina Cercasi lo mostra senza nomi, e chi prepara la bozza di una bici da corsa vede quante persone la aspettano.
 */
test.describe.configure({ mode: 'serial' });

const searchers = ['cerca-a', 'cerca-b', 'cerca-c'].map((n) => testEmail(n));
const sellerEmail = testEmail('vende-bici');
const queries = ['bici da corsa sotto i 900 franchi', 'bici da corsa max 700', 'bici da corsa'];

test.beforeAll(async () => {
  for (const [i, email] of searchers.entries()) {
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: `Cerca ${i}` } });
    // Tre cercano una bici da corsa, due anche un passeggino: due richieste, abbastanza per la striscia in home
    const mine = [queries[i], ...(i < 2 ? ['passeggino trio'] : [])];
    await admin.from('alerts').insert(mine.map((query) => ({ user_id: data.user!.id, query, filters: {} })));
  }
});

test.afterAll(async () => {
  await deleteUsers([...searchers, sellerEmail]);
});

test('Cercasi mostra cosa cercano le persone, senza nomi', async ({ page }) => {
  await expect(async () => {
    await page.goto('/cercasi');
    await expect(page.locator('.group', { hasText: 'Bici da corsa' })).toContainText('3', { timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  const row = page.locator('.group', { hasText: 'Bici da corsa' });
  await expect(row).toContainText('budget tipico fino a CHF 700');
  await expect(page.locator('main')).not.toContainText('Cerca 0');
  await row.getByRole('link', { name: "Ce l'ho, lo vendo" }).click();
  await expect(page).toHaveURL(/\/vendi\?nota=bici/);
  await expect(page.getByLabel('Due righe, se vuoi')).toHaveValue('bici da corsa');
});

test('in home la striscia «Si cerca»: un tocco e si vende o si cerca anche', async ({ page }) => {
  await page.goto('/');
  const chip = page.locator('.ws-chip', { hasText: 'Bici da corsa' });
  await expect(chip).toContainText('3');
  await expect(page.locator('.ws-chip', { hasText: 'Passeggini' })).toContainText('2');
  await chip.click();
  const pick = page.locator('.ws-pick');
  await expect(pick).toContainText('3 persone cercano «Bici da corsa»');
  await expect(pick.getByRole('link', { name: "Ce l'ho, lo vendo" })).toHaveAttribute('href', '/vendi?nota=bici%20da%20corsa');
  await pick.getByRole('button', { name: "Lo cerco anch'io" }).click();
  await expect(page).toHaveURL(/\/accedi\?next=%2F/);
});

test('nella bozza: lo cercano in 3, con i budget', async ({ page }) => {
  await login(page, sellerEmail, '/vendi');
  await page.getByLabel('Due righe, se vuoi').fill('Bici da corsa Bianchi, telaio 55, cambio Shimano');
  await page.locator('#comune').fill('Lugano');
  await page.getByRole('option', { name: /^Lugano/ }).click();
  await page.getByRole('button', { name: 'Prepara la bozza' }).click();
  const box = page.locator('.demand');
  await expect(box).toContainText('Lo cercano in 3');
  await expect(box).toContainText("da CHF 700.– a CHF 900.–");
  await page.locator('#draft-price').fill('1200');
  await expect(box).toContainText('sopra il budget di tutti');
});
