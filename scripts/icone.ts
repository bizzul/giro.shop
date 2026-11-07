/**
 * Icone del sito e immagine di anteprima per le condivisioni (WhatsApp, Telegram, Facebook, X, LinkedIn, iMessage…),
 * tutte dal marchio di public/favicon.svg. Scrive in public/:
 * - favicon.ico (16, 32 e 48 px) per i browser e i servizi che cercano solo /favicon.ico;
 * - apple-touch-icon.png (180 px, a tutto quadrato: iOS arrotonda da sé);
 * - icon-192.png, icon-512.png e icon-maskable-512.png per site.webmanifest (Android, "Aggiungi a schermata Home");
 * - og.png (1200×630): l'anteprima delle pagine senza foto propria. Disegnata con Chromium (Playwright) per avere i
 *   font del sito; gli annunci usano invece la loro foto (src/pages/og/annuncio/[id].jpg.ts).
 * Uso: pnpm icone
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { chromium } from '@playwright/test';

const VOLT = '#3043FF';
const out = (name: string) => new URL(`../public/${name}`, import.meta.url);

/** Il marchio: la freccia che torna indietro (un oggetto che fa il giro). `inset` = margine in unità su 32. */
function mark(size: number, { rounded = true, inset = 0 } = {}): Buffer {
  const scale = (32 - inset * 2) / 32;
  const bg = rounded ? `<rect x="1" y="1" width="30" height="30" rx="9" fill="${VOLT}"/>` : `<rect width="32" height="32" fill="${VOLT}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${bg}
    <g transform="translate(${inset} ${inset}) scale(${scale})" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="15" cy="13" r="5.6"/><path d="M20.6 13V20a5 5 0 0 1-5 5H11.5"/><path d="M14 22.4L11.5 25L14 27.6"/>
    </g></svg>`;
  return Buffer.from(svg);
}

const png = (svg: Buffer, size: number) => sharp(svg, { density: 72 * Math.max(1, size / 32) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** .ico con dentro dei PNG (lo leggono tutti i browser da Windows Vista in poi). */
function ico(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // piani
    e.writeUInt16LE(32, 6); // bit per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const icoSizes = [16, 32, 48];
writeFileSync(out('favicon.ico'), ico(await Promise.all(icoSizes.map(async (size) => ({ size, data: await png(mark(size), size) })))));
writeFileSync(out('apple-touch-icon.png'), await png(mark(180, { rounded: false, inset: 3 }), 180));
writeFileSync(out('icon-192.png'), await png(mark(192), 192));
writeFileSync(out('icon-512.png'), await png(mark(512), 512));
// Maskable: Android ritaglia a cerchio o goccia, il disegno deve stare nel 80% centrale
writeFileSync(out('icon-maskable-512.png'), await png(mark(512, { rounded: false, inset: 6 }), 512));
console.log('✓ favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png');

// Anteprima per le condivisioni
const font = (file: string) => `data:font/woff2;base64,${readFileSync(new URL(`../src/assets/fonts/${file}`, import.meta.url)).toString('base64')}`;
const markSvg = readFileSync(out('favicon.svg'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Archivo; font-weight: 300 700; src: url(${font('archivo-latin.woff2')}) format('woff2'); }
  @font-face { font-family: 'Instrument Sans'; font-weight: 400 600; src: url(${font('instrument-sans-latin.woff2')}) format('woff2'); }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #fff; color: #111; font-family: 'Instrument Sans', sans-serif; position: relative; overflow: hidden; }
  .card { position: absolute; inset: 0; padding: 84px 92px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 22px; }
  .brand svg { width: 84px; height: 84px; }
  .word { font: 500 76px/1 Archivo; letter-spacing: -0.045em; }
  .word span { color: #6b6b68; }
  h1 { font: 400 92px/0.98 Archivo; letter-spacing: -0.045em; max-width: 820px; }
  h1 em { font-style: normal; color: ${VOLT}; }
  p { font-size: 32px; color: #6b6b68; letter-spacing: -0.01em; }
  .ring { position: absolute; right: -170px; top: -150px; width: 620px; height: 620px; border-radius: 50%; border: 64px solid #e2e5ff; }
  .ring2 { position: absolute; right: 40px; bottom: -260px; width: 420px; height: 420px; border-radius: 50%; border: 2px solid #e8e8e5; }
</style></head><body>
  <div class="ring"></div><div class="ring2"></div>
  <div class="card">
    <div class="brand">${markSvg}<div class="word">giro<span>.shop</span></div></div>
    <h1>Compra e vendi<br><em>in Ticino</em></h1>
    <p>Annunci da una foto · ricerca a parole tue · assistente AI</p>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const shot = await page.screenshot({ type: 'png' });
await browser.close();
writeFileSync(out('og.png'), await sharp(shot).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
console.log('✓ og.png (1200×630)');
