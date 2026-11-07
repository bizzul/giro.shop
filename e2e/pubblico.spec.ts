import { expect, test } from '@playwright/test';
import { hydrated } from './islands.ts';

test.describe('senza account', () => {
  test('la home mostra gli ultimi annunci', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ultimi annunci' })).toBeVisible();
    await expect(page.locator('.cards .lcard').first()).toBeVisible();
  });

  test('ricerca in linguaggio naturale: filtri capiti e removibili', async ({ page }) => {
    await page.goto(`/cerca?q=${encodeURIComponent('scrivania in legno sotto i 150 franchi vicino a Lugano')}`);
    const chips = page.locator('.understood');
    await expect(chips.getByText('Prezzo', { exact: true })).toBeVisible();
    await expect(chips.getByText('Zona', { exact: true })).toBeVisible();
    await expect(page.locator('[data-status]')).toContainText('4 annunci');
    // Togliere il prezzo allarga la ricerca, senza ricaricare la pagina
    await page.getByRole('link', { name: /Togli il filtro Prezzo/ }).click();
    await expect(chips.getByText('Prezzo', { exact: true })).toHaveCount(0);
    await expect(page.locator('form[data-live] input[name="q"]')).toHaveValue(/scrivania in legno vicino a Lugano/);
  });

  test('ricerca per significato: «sofà» trova il divano', async ({ page, request }) => {
    // Il modello locale si carica al primo uso: si aspetta che sia pronto (al massimo un minuto)
    await expect
      .poll(async () => (await (await request.get(`/risultati?q=${encodeURIComponent('sofà')}&vista=cerca`)).text()).includes('stesso significato'), { timeout: 60_000, intervals: [2_000] })
      .toBe(true);
    await page.goto(`/cerca?q=${encodeURIComponent('sofà')}`);
    const card = page.locator('.lcard', { hasText: 'Divano 3 posti' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('stesso significato');
    await expect(page.locator('[data-status]')).toContainText('nessuno usa proprio queste parole');
  });

  test('scheda annuncio con prezzo e dati strutturati per Google', async ({ page }) => {
    await page.goto('/annuncio/l-010');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Divano');
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(jsonLd ?? '{}')['@type']).toBe('Product');
  });

  test('distanze da te: si scrive il comune e si sceglie', async ({ page }) => {
    await page.goto(`/cerca?q=${encodeURIComponent('divano')}`);
    await page.getByRole('button', { name: 'Distanze da te' }).click();
    const dialog = page.getByRole('dialog', { name: 'Da dove parti?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('bellinz');
    await dialog.getByRole('option', { name: /Bellinzona/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Distanze da Bellinzona' })).toBeVisible();
    await expect(page.locator('.lcard').first()).toContainText('km da te');
    await expect(page.getByRole('status').filter({ hasText: 'Distanze da Bellinzona' })).toBeVisible();
  });

  test('Vendi: il comune arriva dalle coordinate della foto, che parte senza posizione', async ({ page }) => {
    await page.goto('/vendi');
    await hydrated(page, 'SellForm');
    await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/foto-gps-locarno.jpg');
    await expect(page.locator('#comune')).toHaveValue('Locarno');
    await expect(page.getByRole('status').filter({ hasText: 'Dalle coordinate della foto: Locarno' })).toBeVisible();
    // Si guarda cosa partirebbe verso il server, senza mandarlo: il comune sì, i metadati con la posizione no
    let sent: Buffer | null = null;
    await page.route('**/_actions/createDraft**', async (route) => {
      sent = route.request().postDataBuffer();
      await route.abort();
    });
    await page.getByRole('button', { name: 'Prepara la bozza' }).click();
    await expect.poll(() => sent?.length ?? 0).toBeGreaterThan(0);
    expect(sent!.includes('Locarno')).toBe(true);
    expect(sent!.includes('Exif')).toBe(false);
  });

  test('Vendi: il comune scelto dalla persona resta, anche con una foto che dice altro', async ({ page }) => {
    await page.goto('/vendi');
    await hydrated(page, 'SellForm');
    await page.locator('#comune').fill('Lugano');
    await page.getByRole('option', { name: /^Lugano/ }).click();
    await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/foto-gps-locarno.jpg');
    await expect(page.locator('.ph-grid img, .photos img').first()).toBeVisible();
    await expect(page.locator('#comune')).toHaveValue('Lugano');
  });

  test.describe('con la posizione del telefono permessa', () => {
    test.use({ geolocation: { latitude: 46.1946, longitude: 9.0244 }, permissions: ['geolocation'] });

    test('Vendi: senza coordinate nella foto il comune arriva dalla posizione', async ({ page }) => {
      await page.goto('/vendi');
      await hydrated(page, 'SellForm');
      await page.locator('input[type="file"]').first().setInputFiles('public/foto/l-010.webp');
      await expect(page.locator('#comune')).toHaveValue('Bellinzona');
      await expect(page.getByRole('status').filter({ hasText: 'Dalla tua posizione: Bellinzona' })).toBeVisible();
    });
  });

  test('le pagine personali portano al login e poi indietro', async ({ page }) => {
    await page.goto('/miei-annunci');
    await expect(page).toHaveURL(/\/accedi\?next=(%2F|\/)miei-annunci/);
    await expect(page.getByRole('button', { name: 'Mandami il link' })).toBeVisible();
  });
});
