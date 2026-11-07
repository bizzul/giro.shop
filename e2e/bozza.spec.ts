import { expect, test } from '@playwright/test';
import { accessCode, deleteUsers, login, testEmail } from './helpers.ts';
import { hydrated } from './islands.ts';

/** La bozza di Vendi preparata senza account resta nel browser durante l'accesso e si pubblica al ritorno. */
const email = testEmail('bozza');
const codeEmail = testEmail('codice');
const loginCodeEmail = testEmail('codice-accesso');
test.afterAll(() => deleteUsers([email, codeEmail, loginCodeEmail]));

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

  await page.getByRole('link', { name: 'Accedi con il link o la passkey' }).click();
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

test('primo annuncio senza account: email e codice nella pagina, e si pubblica subito', async ({ page }) => {
  await page.goto('/vendi');
  await hydrated(page, 'SellForm');
  await page.locator('input[type="file"]').first().setInputFiles('public/foto/l-002.webp');
  await expect(page.locator('.ph-grid img, .photos img').first()).toBeVisible();
  await page.getByLabel('Due righe, se vuoi').fill('Lampada da tavolo in ottone');
  await page.locator('#comune').fill('Locarno');
  await page.getByRole('option', { name: /^Locarno/ }).click();
  await page.getByRole('button', { name: 'Prepara la bozza' }).click();
  await page.locator('#draft-title').fill('Lampada con il codice');
  await page.locator('#draft-price').fill('35');

  await page.getByLabel('La tua email, per pubblicare').fill(codeEmail);
  await page.getByRole('button', { name: 'Mandami il codice' }).click();
  // Un codice sbagliato si dice, e la bozza resta lì
  await page.getByLabel('Codice').fill('000000');
  await page.getByRole('button', { name: 'Conferma e pubblica' }).click();
  await expect(page.getByRole('alert')).toContainText('Codice sbagliato');
  await page.getByLabel('Codice').fill(await accessCode(codeEmail));
  await page.getByRole('button', { name: 'Conferma e pubblica' }).click();
  await page.waitForURL(/\/annuncio\/.+-lampada-con-il-codice$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lampada con il codice');
});

test('anche nella pagina di accesso si entra con il codice', async ({ page }) => {
  await page.goto('/accedi?next=/salvati');
  await page.getByLabel('Email').fill(loginCodeEmail);
  await page.getByRole('button', { name: 'Mandami il link' }).click();
  await expect(page.getByRole('heading', { name: 'Ti abbiamo mandato un link.' })).toBeVisible();
  await page.getByLabel('Codice').fill(await accessCode(loginCodeEmail));
  await page.getByRole('button', { name: 'Entra' }).click();
  await page.waitForURL((url) => url.pathname === '/salvati');
});
