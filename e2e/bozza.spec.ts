import { expect, test } from '@playwright/test';
import { deleteUsers, login, testEmail } from './helpers.ts';
import { hydrated } from './islands.ts';

/** La bozza di Vendi preparata senza account resta nel browser durante l'accesso e si pubblica al ritorno. */
const email = testEmail('bozza');
test.afterAll(() => deleteUsers([email]));

test('bozza senza account: si accede e si ritrova, poi si pubblica', async ({ page }) => {
  await page.goto('/vendi');
  await hydrated(page, 'SellForm');
  await page.locator('input[type="file"]').first().setInputFiles('public/foto/l-001.webp');
  await expect(page.locator('.ph-grid img, .photos img').first()).toBeVisible();
  await page.getByLabel('Due righe, se vuoi').fill('Scrivania in legno, due cassetti');
  await page.locator('#comune').fill('Bellinzona');
  await page.getByRole('option', { name: /^Bellinzona/ }).click();
  await page.getByRole('button', { name: 'Prepara la bozza' }).click();
  await page.locator('#draft-title').fill('Scrivania da ritrovare');
  await page.locator('#draft-price').fill('90');

  await page.getByRole('link', { name: 'Accedi per pubblicare' }).click();
  await page.waitForURL(/\/accedi/);
  await login(page, email, '/vendi');
  await hydrated(page, 'SellForm');
  await expect(page.getByRole('status').filter({ hasText: 'Bozza ripresa' })).toBeVisible();
  await expect(page.locator('#draft-title')).toHaveValue('Scrivania da ritrovare');
  await expect(page.locator('#draft-price')).toHaveValue('90');
  await expect(page.locator('.ph-grid img, .photos img').first()).toBeVisible();

  await page.getByRole('button', { name: 'Pubblica annuncio' }).click();
  await page.waitForURL(/\/annuncio\/.+-scrivania-da-ritrovare$/);
  // Dopo la pubblicazione la bozza non c'è più
  await page.goto('/vendi');
  await hydrated(page, 'SellForm');
  await expect(page.getByRole('button', { name: 'Prepara la bozza' })).toBeVisible();
});
