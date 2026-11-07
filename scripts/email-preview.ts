/**
 * Anteprima delle email (accesso, avviso, riassunto) con il disegno di src/lib/email-design.ts:
 * le scrive in HTML e le fotografa con il Chrome installato, a misura di computer e di telefono.
 * Uso: node scripts/email-preview.ts <cartella>   (con `pnpm dev` acceso: logo e foto arrivano da lì)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { C, button, emailLayout, footLink, heading, label, listingCard, note, paragraph, rows } from '../src/lib/email-design.ts';

const OUT = process.argv[2] ?? 'anteprima-email';
const O = 'http://localhost:4321';
mkdirSync(OUT, { recursive: true });

const prefs = footLink(`${O}/miei-annunci#email`, 'Un riassunto al giorno, o meno email');

const emails: Record<string, string> = {
  accesso: emailLayout({
    origin: O,
    preheader: "Il link vale un'ora. Aprilo nello stesso browser da cui l'hai chiesto.",
    body:
      label('Accesso') +
      heading('Entra in giro.shop') +
      paragraph("Tocca il bottone per entrare. Il link vale un'ora e va aperto nello stesso browser da cui l'hai chiesto.") +
      button('#', 'Entra') +
      note("Non l'hai chiesto tu? Ignora questa email: senza il link nessuno entra nel tuo account. Non ti chiederemo mai una password o un codice per email."),
  }),
  avviso: emailLayout({
    origin: O,
    preheader: 'Divano 3 posti grigio, sfoderabile · CHF 250.– · Giubiasco',
    body:
      label('Ricerca salvata · «sofà»', C.volt) +
      heading("C'è un nuovo annuncio per te") +
      listingCard({
        url: `${O}/annuncio/l-010`,
        photo: `${O}/foto/l-010.webp`,
        title: 'Divano 3 posti grigio, sfoderabile',
        price: 'CHF 250.–',
        place: 'Giubiasco · ritiro, o spedizione da concordare',
        badges: [
          { text: 'Nuovo oggi', dot: C.sun },
          { text: 'Prezzo giusto', dot: C.ok },
        ],
      }) +
      button(`${O}/annuncio/l-010`, "Apri l'annuncio"),
    footer: `Ricevi questa email per: nuovi annunci per le tue ricerche salvate.<br>${prefs} · ${footLink('#', 'Non voglio più queste email')}`,
  }),
  riassunto: emailLayout({
    origin: O,
    preheader: '3 avvisi che non hai ancora visto',
    body:
      label('Il riassunto di oggi') +
      heading('3 avvisi che non hai ancora visto') +
      rows([
        { url: `${O}/annuncio/l-010`, kind: 'Ricerca salvata · «sofà»', title: 'Divano 3 posti grigio, sfoderabile', price: 'CHF 250.–', detail: 'Giubiasco', photo: `${O}/foto/l-010-sm.webp` },
        { url: `${O}/annuncio/l-001`, kind: 'Prezzo ridotto', title: 'Scrivania in noce massello, 120×60', price: 'CHF 140.–', detail: 'Prima CHF 160.– · Massagno', photo: `${O}/foto/l-001-sm.webp` },
        { url: `${O}/annuncio/l-001#domande`, kind: 'Risposta', title: 'Hanno risposto alla tua domanda', detail: '«Solo qualche segno leggero sul bordo, niente graffi profondi.»', photo: `${O}/foto/l-001-sm.webp` },
      ]) +
      button(`${O}/avvisi`, 'Tutti i tuoi avvisi'),
    footer: `Ricevi un riassunto al giorno, alle 18. ${footLink(`${O}/miei-annunci#email`, 'Cambia quando e per cosa')} · ${footLink('#', 'Non voglio più email')}`,
  }),
};

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [name, html] of Object.entries(emails)) {
    writeFileSync(`${OUT}/${name}.html`, html);
    for (const [size, width] of [['computer', 680], ['telefono', 390]] as const) {
      const page = await browser.newPage({ viewport: { width, height: 200 }, deviceScaleFactor: 2 });
      // Dalla stessa origine del sito: da una pagina vuota Chrome non carica immagini da localhost
      await page.goto(`${O}/robots.txt`);
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/${name}-${size}.png`, fullPage: true });
      await page.close();
    }
    console.log(`✓ ${name}`);
  }
} finally {
  await browser.close();
}
