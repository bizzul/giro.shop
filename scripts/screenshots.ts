/**
 * Screenshot del README (docs/screenshots/*.webp), con il Chrome installato e il sito in sviluppo.
 * Per le schermate che ne hanno bisogno aggiunge per poco dati d'esempio al database locale
 * (storico del prezzo, una domanda, alcuni avvisi, una segnalazione) e li toglie alla fine.
 * Accede come l'utente di prova (prova@esempio.test) con il link via email letto da Mailpit.
 * Uso: pnpm screenshots   (con `supabase start` e `pnpm dev` accesi)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { chromium, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const OUT = 'docs/screenshots';
const PROVA = 'prova@esempio.test';
const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' }));
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const MAILPIT = status.MAILPIT_URL ?? status.INBUCKET_URL;
mkdirSync(OUT, { recursive: true });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

/** Salva in WebP, larghezza fissa; `maxHeight` taglia le pagine lunghe. */
async function save(name: string, png: Buffer, maxHeight = 1600) {
  const img = sharp(png);
  const meta = await img.metadata();
  const height = Math.min(meta.height ?? maxHeight, maxHeight);
  await img.extract({ left: 0, top: 0, width: meta.width!, height }).webp({ quality: 80 }).toFile(`${OUT}/${name}.webp`);
  console.log(`✓ ${name}`);
}

async function shot(page: Page, name: string, options: { full?: boolean; maxHeight?: number } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await wait(300);
  await save(name, await page.screenshot({ fullPage: options.full ?? false }), options.maxHeight);
}

async function magicLink(email: string, after: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const { messages } = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as {
      messages: Array<{ ID: string; Created: string }>;
    };
    const fresh = messages?.find((m) => new Date(m.Created).getTime() >= after);
    if (fresh) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string; Text: string };
      const link = (msg.HTML + msg.Text).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/)?.[0];
      if (link) return link.replace(/&amp;/g, '&');
    }
    await wait(500);
  }
  throw new Error(`Nessuna email di accesso per ${email}`);
}

// ── Dati d'esempio, tolti alla fine ────────────────────────────────────────────
const cleanup: Array<() => PromiseLike<unknown>> = [];
const { data: prova } = await admin.from('profiles').select('id').eq('id', (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === PROVA)!.id).single();
const provaId = prova!.id as string;
const { data: others } = await admin.from('profiles').select('id, display_name').neq('id', provaId).limit(3);
const [paolo, davide] = others!;

// Storico del prezzo della scrivania l-001 (oggi 140): 190 → 160 → 140
const { data: history } = await admin
  .from('price_history')
  .insert([
    { listing_id: 'l-001', price_chf: 190, changed_at: days(40) },
    { listing_id: 'l-001', price_chf: 160, changed_at: days(18) },
  ])
  .select('id');
cleanup.push(() => admin.from('price_history').delete().in('id', history!.map((h) => h.id)));

// Una domanda pubblica con risposta
const { data: question } = await admin
  .from('questions')
  .insert({
    listing_id: 'l-001',
    asker_id: paolo.id,
    body: 'Il piano ha segni di bicchieri o graffi profondi?',
    answer: 'Solo qualche segno leggero sul bordo, niente graffi profondi. Si vede bene nella terza foto.',
    answered_at: days(1),
    created_at: days(2),
    helpful: 4,
  })
  .select('id')
  .single();
cleanup.push(() => admin.from('questions').delete().eq('id', question!.id));

// Avvisi vari per la persona di prova
const { data: notices } = await admin
  .from('notifications')
  .insert([
    { user_id: provaId, kind: 'ricerca', title: 'Nuovo annuncio per «sofà»', body: 'Divano 3 posti grigio, sfoderabile · CHF 250.– · Giubiasco', url: '/annuncio/l-010', listing_id: 'l-010', created_at: days(0.05) },
    { user_id: provaId, kind: 'prezzo', title: 'Prezzo ridotto: Scrivania in noce massello', body: 'Ora CHF 140.–, prima CHF 160.–', url: '/annuncio/l-001', listing_id: 'l-001', created_at: days(0.4) },
    { user_id: provaId, kind: 'risposta', title: 'Hanno risposto alla tua domanda', body: 'Solo qualche segno leggero sul bordo, niente graffi profondi.', url: '/annuncio/l-001#domande', listing_id: 'l-001', created_at: days(1) },
  ])
  .select('id');
cleanup.push(() => admin.from('notifications').delete().in('id', notices!.map((n) => n.id)));
// Gli avvisi che la persona di prova ha già (spesso residui di verifiche) si mettono da parte e tornano alla fine
const { data: existing } = await admin.from('notifications').select('*').eq('user_id', provaId).not('id', 'in', `(${notices!.map((n) => n.id).join(',')})`);
if (existing?.length) {
  await admin.from('notifications').delete().in('id', existing.map((n) => n.id));
  cleanup.push(() => admin.from('notifications').insert(existing));
}

// Una ricerca salvata
const { data: alert } = await admin.from('alerts').insert({ user_id: provaId, query: 'sofà', filters: {} }).select('id').single();
cleanup.push(() => admin.from('alerts').delete().eq('id', alert!.id));

// Una segnalazione da esaminare (pagina di moderazione)
const { data: report } = await admin
  .from('reports')
  .insert({ reporter_id: davide.id, listing_id: 'l-007', reason: 'truffa', note: 'Il venditore mi ha chiesto di pagare prima con un link.' })
  .select('id')
  .single();
cleanup.push(() => admin.from('reports').delete().eq('id', report!.id));

// Un assistente collegato e la sua richiesta di consenso
const reg = await (await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) })).json();
cleanup.push(() => admin.from('oauth_clients').delete().eq('id', reg.client_id));

/** La barra degli strumenti di Astro (solo in sviluppo) non va nelle immagini. */
const HIDE_DEV_TOOLBAR = () => {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'astro-dev-toolbar { display: none !important; }';
    document.head.append(style);
  });
};

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-CH', timezoneId: 'Europe/Zurich', colorScheme: 'light', reducedMotion: 'reduce' });
  await desktop.addInitScript(HIDE_DEV_TOOLBAR);
  const page = await desktop.newPage();

  // Il modello della ricerca per significato si carica al primo uso
  for (let i = 0; i < 30; i++) {
    if ((await (await fetch(`${BASE}/risultati?q=${encodeURIComponent('sofà')}&vista=cerca`)).text()).includes('stesso significato')) break;
    await wait(2000);
  }

  await page.goto(`${BASE}/`);
  await shot(page, '01-home');

  await page.goto(`${BASE}/cerca?q=${encodeURIComponent('scrivania in legno sotto i 150 franchi vicino a Lugano')}`);
  await shot(page, '02-ricerca');

  await page.goto(`${BASE}/cerca?q=${encodeURIComponent('sofà')}`);
  await shot(page, '03-significato');

  await page.goto(`${BASE}/annuncio/l-001`);
  await shot(page, '04-annuncio');
  // Domande pubbliche e storico del prezzo, più in basso nella stessa scheda
  const from = await page.getByRole('heading', { name: /^Domande/ }).first().boundingBox();
  const to = await page.getByRole('heading', { name: /^Come stimiamo il prezzo/ }).first().boundingBox();
  if (from && to) {
    const png = await page.screenshot({ fullPage: true, clip: { x: from.x - 40, y: from.y - 30, width: 560, height: to.y - from.y } });
    await save('04b-domande-prezzo', png, 2000);
  }

  await page.goto(`${BASE}/cerca?q=divano`);
  await page.getByRole('button', { name: 'Distanze da te' }).click();
  await page.getByRole('dialog').getByRole('combobox').fill('bel');
  await shot(page, '05-distanze');
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}/connetti`);
  await shot(page, '10-connettore');

  // Con l'accesso di prova
  const asked = Date.now() - 1000;
  await page.goto(`${BASE}/accedi?next=/miei-annunci`);
  await page.getByLabel('Email').fill(PROVA);
  await page.getByRole('button', { name: 'Mandami il link' }).click();
  await page.getByRole('heading', { name: 'Ti abbiamo mandato un link.' }).waitFor();
  await page.goto(await magicLink(PROVA, asked));
  await page.waitForURL(/\/miei-annunci/);

  await page.goto(`${BASE}/vendi`);
  // Aspetta che l'isola Preact sia attiva, poi carica la foto nel suo campo
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.locator('.photos-field input[type="file"]').setInputFiles('public/foto/l-001.webp');
  await page.locator('.ph-grid img').first().waitFor();
  await page.getByLabel('Due righe, se vuoi').fill('Scrivania in noce massello 120×60, cassetto centrale, qualche segno leggero sul piano');
  await page.locator('#comune').fill('Lugano');
  await page.getByRole('option', { name: /^Lugano/ }).click();
  await page.getByRole('button', { name: 'Prepara la bozza' }).click();
  await page.locator('#draft-title').waitFor();
  await shot(page, '06-vendi', { full: true, maxHeight: 2000 });

  const { data: conv } = await admin.from('conversations').select('id').or(`buyer_id.eq.${provaId},seller_id.eq.${provaId}`).limit(1).maybeSingle();
  if (conv) {
    // Più alta, per vedere tutta la conversazione dall'inizio
    await page.setViewportSize({ width: 1280, height: 1240 });
    await page.goto(`${BASE}/messaggi/${conv.id}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '07-messaggi');
    await page.setViewportSize({ width: 1280, height: 860 });
  }

  await page.goto(`${BASE}/miei-annunci#email`);
  await page.locator('#email').scrollIntoViewIfNeeded();
  await shot(page, '08-account');

  await page.goto(`${BASE}/avvisi`);
  await shot(page, '09-avvisi');

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await page.goto(
    `${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'x', scope: 'ricerche annunci' })}`,
  );
  await shot(page, '11-consenso');

  await page.goto(`${BASE}/moderazione`);
  await shot(page, '12-moderazione', { full: true, maxHeight: 1400 });

  // Telefono: home e scheda, affiancate
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-CH', colorScheme: 'light', reducedMotion: 'reduce' });
  await phone.addInitScript(HIDE_DEV_TOOLBAR);
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/cerca?q=${encodeURIComponent('bici da corsa')}`);
  await mobile.evaluate(() => document.fonts.ready);
  const a = await mobile.screenshot();
  await mobile.goto(`${BASE}/annuncio/l-010`);
  await mobile.evaluate(() => document.fonts.ready);
  const b = await mobile.screenshot();
  const w = 780;
  const h = 1688;
  const pair = await sharp({ create: { width: w * 2 + 60, height: h, channels: 3, background: '#e9e7e2' } })
    .composite([
      { input: a, left: 0, top: 0 },
      { input: b, left: w + 60, top: 0 },
    ])
    .png()
    .toBuffer();
  await save('13-telefono', await sharp(pair).resize({ width: 1000 }).png().toBuffer(), 2400);
  await phone.close();
} finally {
  await browser.close();
  for (const undo of cleanup.reverse()) await undo();
  console.log('Dati d\'esempio tolti.');
}
