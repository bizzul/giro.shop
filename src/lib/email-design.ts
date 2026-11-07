/**
 * Il disegno delle email di giro.shop, uguale al sito: logo, caratteri (Archivo, Instrument Sans, Martian Mono,
 * con Helvetica dove il programma di posta non li carica), etichette maiuscole, bottone nero, prezzi in mono.
 * HTML a tabelle e stili in linea: è quello che leggono Gmail, Apple Mail e Outlook.
 * Una sola fonte per le email del sito (avvisi, riassunto) e per quelle di Supabase (link di accesso).
 */

export const C = {
  page: '#f6f6f4',
  card: '#ffffff',
  ink: '#111111',
  muted: '#6b6b68',
  line: '#e8e8e5',
  volt: '#3043ff',
  ok: '#08704c',
  sun: '#ffb01f',
};

const DISPLAY = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const BODY = "'Instrument Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Martian Mono', 'SF Mono', Menlo, Consolas, monospace";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Etichetta piccola maiuscola, come ".label" del sito. */
export const label = (text: string, color = C.muted) =>
  `<p style="margin:0 0 10px;font:500 11px/1.4 ${BODY};letter-spacing:.08em;text-transform:uppercase;color:${color}">${esc(text)}</p>`;

export const heading = (text: string) =>
  `<h1 style="margin:0 0 14px;font:400 26px/1.15 ${DISPLAY};letter-spacing:-.035em;color:${C.ink}">${esc(text)}</h1>`;

export const paragraph = (html: string, size = 15) =>
  `<p style="margin:0 0 22px;font:400 ${size}px/1.55 ${BODY};color:#333333">${html}</p>`;

/** Bottone nero del sito (".btn.primary"). `href` può essere un segnaposto di Supabase, es. {{ .ConfirmationURL }}. */
export const button = (href: string, text: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:${C.ink};border-radius:2px">` +
  `<a href="${href}" style="display:inline-block;padding:15px 22px;font:500 12px/1 ${BODY};letter-spacing:.08em;text-transform:uppercase;color:#ffffff;text-decoration:none">${esc(text)}</a>` +
  `</td></tr></table>`;

/** Badge con il pallino colorato, come sulle schede annuncio. */
export const badge = (text: string, dot: string) =>
  `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 8px;border:1px solid ${C.line};border-radius:2px;background:#ffffff;font:500 10px/1 ${BODY};letter-spacing:.08em;text-transform:uppercase;color:${C.ink}">` +
  `<span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${dot};margin-right:6px;vertical-align:1px"></span>${esc(text)}</span>`;

/** Il codice di accesso a 6 cifre, grande e spaziato, da scrivere nella pagina (anche un segnaposto: {{ .Token }}). */
export const accessCode = (token: string) =>
  `<p style="margin:24px 0 6px;font:400 13px/1.5 ${BODY};color:${C.muted}">Oppure scrivi questo codice nella pagina di giro.shop da cui l'hai chiesto:</p>` +
  `<p style="margin:0;font:500 30px/1.2 ${MONO};letter-spacing:.18em;color:${C.ink}">${esc(token)}</p>`;

export const price = (chf: string, size = 22) => `<span style="font:500 ${size}px/1.2 ${MONO};letter-spacing:-.02em;color:${C.ink}">${esc(chf)}</span>`;

export interface CardListing {
  url: string;
  photo?: string | null;
  title: string;
  price: string;
  place: string;
  badges?: Array<{ text: string; dot: string }>;
}

/** Un annuncio grande: foto, badge, prezzo, titolo, luogo. Tutto il blocco porta all'annuncio. */
export function listingCard(l: CardListing): string {
  const photo = l.photo
    ? `<a href="${esc(l.url)}"><img src="${esc(l.photo)}" width="496" alt="" style="display:block;width:100%;max-width:496px;height:auto;border-radius:4px;border:0"></a>`
    : '';
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px"><tr><td>` +
    photo +
    `<div style="padding-top:14px">${(l.badges ?? []).map((b) => badge(b.text, b.dot)).join('')}</div>` +
    `<div style="margin:4px 0 6px">${price(l.price)}</div>` +
    `<a href="${esc(l.url)}" style="font:500 17px/1.35 ${BODY};color:${C.ink};text-decoration:none">${esc(l.title)}</a>` +
    `<p style="margin:4px 0 0;font:400 14px/1.4 ${BODY};color:${C.muted}">${esc(l.place)}</p>` +
    `</td></tr></table>`
  );
}

export interface RowItem {
  url: string;
  kind: string;
  title: string;
  detail?: string;
  photo?: string | null;
  price?: string | null;
}

/** Una riga del riassunto: miniatura, tipo di avviso, titolo, prezzo o dettaglio. */
export function listingRow(r: RowItem): string {
  const thumb = r.photo
    ? `<td width="104" valign="top" style="padding:16px 16px 16px 0"><a href="${esc(r.url)}"><img src="${esc(r.photo)}" width="104" height="78" alt="" style="display:block;width:104px;height:78px;object-fit:cover;border-radius:3px;border:0"></a></td>`
    : `<td width="104" valign="top" style="padding:16px 16px 16px 0"><div style="width:104px;height:78px;border-radius:3px;background:${C.page}"></div></td>`;
  return (
    `<tr>${thumb}<td valign="top" style="padding:16px 0;border-bottom:1px solid ${C.line}">` +
    `<p style="margin:0 0 4px;font:500 10px/1.4 ${BODY};letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">${esc(r.kind)}</p>` +
    `<a href="${esc(r.url)}" style="font:500 15px/1.35 ${BODY};color:${C.ink};text-decoration:none">${esc(r.title)}</a>` +
    (r.price ? `<div style="margin-top:4px">${price(r.price, 14)}</div>` : '') +
    (r.detail ? `<p style="margin:4px 0 0;font:400 13px/1.45 ${BODY};color:${C.muted}">${esc(r.detail)}</p>` : '') +
    `</td></tr>`
  );
}

export const rows = (items: RowItem[]) =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border-top:1px solid ${C.line}">${items.map(listingRow).join('')}</table>`;

/** Nota in fondo alla scheda, piccola e grigia; i link sono sottolineati come sul sito. */
export const note = (html: string) => `<p style="margin:20px 0 0;font:400 12.5px/1.55 ${BODY};color:${C.muted}">${html}</p>`;
export const footLink = (href: string, text: string) => `<a href="${href}" style="color:${C.muted};text-decoration:underline">${esc(text)}</a>`;

export interface LayoutInput {
  /** Indirizzo pubblico del sito (per logo e link), oppure un segnaposto di Supabase come {{ .SiteURL }}. */
  origin: string;
  /** Testo che i programmi di posta mostrano accanto all'oggetto. */
  preheader: string;
  body: string;
  /** Righe sotto la scheda: perché ricevi l'email, preferenze, disiscrizione. */
  footer?: string;
}

export function emailLayout({ origin, preheader, body, footer = '' }: LayoutInput): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>giro.shop</title>
<link href="${origin}/fonts/fonts.css" rel="stylesheet">
<style>
  @media (max-width: 600px) {
    .giro-pad { padding: 24px 20px !important; }
    .giro-outer { padding: 12px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C.page}">
<tr><td class="giro-outer" align="center" style="padding:32px 16px">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px">
    <tr><td style="padding:0 4px 18px">
      <a href="${origin}/" style="text-decoration:none"><img src="${origin}/email/giro-logo.png" width="122" height="27" alt="giro.shop" style="display:block;border:0"></a>
    </td></tr>
    <tr><td class="giro-pad" style="background:${C.card};border-radius:8px;padding:32px">
      ${body}
    </td></tr>
    <tr><td style="padding:18px 4px 0;font:400 12px/1.6 ${BODY};color:${C.muted}">
      ${footer}
      <p style="margin:10px 0 0">giro.shop · il mercatino dell'usato del Ticino · ${footLink(`${origin}/privacy`, 'Privacy')}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
