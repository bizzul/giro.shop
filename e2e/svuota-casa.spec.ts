import { expect, test } from '@playwright/test';
import { admin, deleteUsers, login, testEmail } from './helpers.ts';

/**
 * Svuota casa (senza chiave di Claude): due foto, due righe sotto ognuna,
 * due bozze da controllare e pubblicate in un colpo, ognuna con la sua foto.
 */
const email = testEmail('trasloco');

test.afterAll(async () => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = data.users.find((u) => u.email === email)?.id;
  if (id) {
    const { data: folders } = await admin.storage.from('foto').list(id);
    for (const f of folders ?? []) {
      const { data: files } = await admin.storage.from('foto').list(`${id}/${f.name}`);
      if (files?.length) await admin.storage.from('foto').remove(files.map((x) => `${id}/${f.name}/${x.name}`));
    }
  }
  await deleteUsers([email]);
});

test('due foto diventano due annunci pubblicati insieme', async ({ page }) => {
  await login(page, email, '/svuota-casa');
  await page.locator('input[type="file"]').first().setInputFiles(['public/foto/l-010.webp', 'public/foto/l-001.webp']);
  await expect(page.locator('.house-hints li')).toHaveCount(2);
  await page.getByLabel("Cos'è nella foto 1").fill('Divano angolare grigio, tre posti');
  await page.getByLabel("Cos'è nella foto 2").fill('Scrivania in legno di noce, 120 cm');
  await page.getByRole('button', { name: 'Prepara le bozze' }).click();

  await expect(page.locator('.house-item')).toHaveCount(2);
  await expect(page.locator('.recog')).toContainText('2 oggetti da vendere');
  await page.getByLabel('Prezzo di Divano angolare grigio').fill('250');
  await page.getByLabel('Prezzo di Scrivania in legno di noce').fill('120');
  await page.locator('#house-comune').fill('Locarno');
  await page.getByRole('option', { name: /^Locarno/ }).click();
  await page.getByRole('button', { name: 'Pubblica 2 annunci' }).click();
  await expect(page.locator('.notice')).toContainText('Pubblicati 2 annunci');

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = users.users.find((u) => u.email === email)!.id;
  const { data: listings } = await admin.from('listings').select('title, price_chf, comune_id, status, photos:listing_photos(storage_path)').eq('seller_id', id).order('price_chf');
  expect(listings?.map((l) => [l.title, Number(l.price_chf), l.comune_id, l.status, l.photos.length])).toEqual([
    ['Scrivania in legno di noce, 120 cm', 120, 'locarno', 'pubblicato', 1],
    ['Divano angolare grigio', 250, 'locarno', 'pubblicato', 1],
  ]);
});
