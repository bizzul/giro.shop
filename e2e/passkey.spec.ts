import { expect, test } from '@playwright/test';
import { deleteUsers, login, testEmail } from './helpers.ts';

/**
 * Passkey facoltativa: aggiunta dall'account, accesso senza email, poi tolta.
 * Il dispositivo è un autenticatore virtuale di Chrome (WebAuthn via CDP), con impronta sempre riconosciuta.
 */
const email = testEmail('passkey');

test.afterAll(async () => {
  await deleteUsers([email]);
});

test('aggiungere una passkey, entrare con quella, toglierla', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // Prima volta: link via email, poi la passkey dall'account
  await login(page, email);
  const panel = page.locator('#passkey');
  await expect(panel.getByRole('heading', { name: 'Passkey' })).toBeVisible();
  await panel.getByRole('button', { name: 'Aggiungi una passkey' }).click();
  await expect(panel.getByRole('status')).toContainText('Passkey aggiunta');
  await expect(panel.locator('.passkeys > li')).toHaveCount(1);
  await expect(panel.locator('.passkeys')).toContainText('Chrome');
  await expect(panel.locator('.passkeys')).toContainText('mai usata');
  await expect(panel.getByRole('button', { name: "Aggiungi un'altra passkey" })).toBeVisible();

  // Fuori e di nuovo dentro, senza email: si arriva dove si voleva andare
  await page.getByRole('button', { name: 'Esci' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.goto('/accedi?next=/salvati');
  await page.getByRole('button', { name: 'Entra con una passkey' }).click();
  await page.waitForURL((url) => url.pathname === '/salvati');

  await page.goto('/miei-annunci#passkey');
  await expect(panel.locator('.passkeys')).toContainText('usata adesso');

  // Tolta dall'account, la passkey rimasta sul dispositivo non apre più niente
  await panel.getByRole('button', { name: /^Togli la passkey/ }).click();
  await expect(panel.getByRole('status')).toContainText('Passkey tolta');
  await expect(panel.locator('.passkeys > li')).toHaveCount(0);

  await page.getByRole('button', { name: 'Esci' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.goto('/accedi');
  await page.getByRole('button', { name: 'Entra con una passkey' }).click();
  await expect(page.getByRole('alert')).toContainText("forse l'hai tolta dal tuo account");
  await expect(page).toHaveURL(/\/accedi/);
});
