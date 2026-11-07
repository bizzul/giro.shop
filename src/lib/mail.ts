import nodemailer, { type Transporter } from 'nodemailer';
import { C, button, emailLayout, esc, footLink, heading, label, listingCard, paragraph, rows, type CardListing } from './email-design.ts';

let transport: Transporter | null | undefined;

function transporter(): Transporter | null {
  if (transport !== undefined) return transport;
  const host = import.meta.env?.SMTP_HOST ?? process.env.SMTP_HOST;
  const port = Number(import.meta.env?.SMTP_PORT ?? process.env.SMTP_PORT ?? 587);
  const user = import.meta.env?.SMTP_USER ?? process.env.SMTP_USER;
  const pass = import.meta.env?.SMTP_PASS ?? process.env.SMTP_PASS;
  transport = host ? nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined }) : null;
  return transport;
}

export function mailFrom(): string {
  return import.meta.env?.MAIL_FROM ?? process.env.MAIL_FROM ?? 'giro.shop <avvisi@giro.shop>';
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

/** Domini riservati ai test (RFC 2606/6761): non ricevono posta. */
const TEST_DOMAIN = /\.(test|example|invalid|localhost)$/i;
const LOCAL_SMTP = /^(127\.0\.0\.1|localhost|::1|.*inbucket.*|.*mailpit.*)$/i;

/**
 * Con un servizio vero (es. Resend) le email agli account di prova (@esempio.test) non partono:
 * tornerebbero indietro e rovinerebbero la reputazione del dominio. In locale (Mailpit) partono tutte.
 */
export function deliverable(to: string, smtpHost: string | undefined): boolean {
  const domain = to.split('@').pop() ?? '';
  return LOCAL_SMTP.test(smtpHost ?? '') || !TEST_DOMAIN.test(domain);
}

/** Manda un'email. Restituisce false (senza eccezioni) se l'invio non è configurato o non riesce. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const t = transporter();
  if (!t) return false;
  if (!deliverable(mail.to, import.meta.env?.SMTP_HOST ?? process.env.SMTP_HOST)) return false;
  try {
    await t.sendMail({ from: mailFrom(), ...mail });
    return true;
  } catch (error) {
    console.warn(`[giro] email a ${mail.to} non inviata: ${(error as Error).message}`);
    return false;
  }
}


/** Etichetta e bottone di ogni tipo di avviso. */
const KIND: Record<string, { label: string; action: string }> = {
  ricerca: { label: 'Ricerca salvata', action: "Apri l'annuncio" },
  prezzo: { label: 'Prezzo ridotto', action: "Apri l'annuncio" },
  venduto: { label: 'Venduto', action: 'Vedi simili' },
  domanda: { label: 'Nuova domanda', action: 'Rispondi' },
  risposta: { label: 'Risposta', action: 'Leggi la risposta' },
  valutazione: { label: 'Valutazione', action: 'Vedi la valutazione' },
  scadenza: { label: 'Scadenza', action: 'Rinnova' },
  segnalazione: { label: 'Moderazione', action: 'Apri' },
  contestazione: { label: 'Contestazione', action: 'Apri' },
};
const kindOf = (kind?: string) => KIND[kind ?? ''] ?? { label: 'Avviso', action: 'Apri' };

/** Disiscrizione con un clic dal programma di posta (RFC 8058) */
const unsubscribeHeaders = (stop: string | null) =>
  stop ? { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;

/**
 * Un avviso per email, con il disegno del sito (email-design.ts). Con `listing` mostra la scheda dell'annuncio.
 * `about` è il tipo di avviso ("Valutazioni che ricevi"): il link in fondo spegne solo quello.
 */
export function noticeMail(input: {
  to: string;
  title: string;
  body: string;
  url: string;
  origin: string;
  unsubscribe: string | null;
  about?: string;
  kind?: string;
  listing?: CardListing | null;
}): Mail {
  const link = `${input.origin}${input.url}`;
  const prefs = `${input.origin}/miei-annunci#email`;
  const stop = input.unsubscribe;
  const stopLabel = input.about ? 'Non voglio più queste email' : 'Non voglio più email';
  const kind = kindOf(input.kind);
  // Per un nuovo annuncio il testo ripete la scheda: basta la scheda
  const showBody = Boolean(input.body) && !(input.listing && input.kind === 'ricerca');
  return {
    to: input.to,
    subject: input.title,
    headers: unsubscribeHeaders(stop),
    text: `${input.title}\n\n${input.body}\n\nApri: ${link}\n\n— giro.shop\n${input.about ? `Ricevi questa email per: ${input.about}.\n` : ''}Preferisci un riassunto al giorno o meno email? ${prefs}${stop ? `\n${stopLabel}: ${stop}` : ''}`,
    html: emailLayout({
      origin: input.origin,
      preheader: input.body || input.title,
      body:
        label(kind.label, C.volt) +
        heading(input.title) +
        (showBody ? paragraph(esc(input.body)) : '') +
        (input.listing ? listingCard(input.listing) : '') +
        button(link, kind.action),
      footer:
        (input.about ? `Ricevi questa email per: ${esc(input.about.toLowerCase())}.<br>` : '') +
        footLink(prefs, 'Un riassunto al giorno, o meno email') +
        (stop ? ` · ${footLink(esc(stop), stopLabel)}` : ''),
    }),
  };
}

export interface DigestItem {
  title: string;
  body: string;
  url: string;
  kind?: string;
  listing?: CardListing | null;
}

/** Il riassunto della sera: tutti gli avvisi del giorno non ancora visti, in una email. */
export function digestMail(input: { to: string; items: DigestItem[]; origin: string; unsubscribe: string | null }): Mail {
  const n = input.items.length;
  const subject = n === 1 ? `Il riassunto di oggi: ${input.items[0].title}` : `Il riassunto di oggi: ${n} avvisi`;
  const all = `${input.origin}/avvisi`;
  const prefs = `${input.origin}/miei-annunci#email`;
  const stop = input.unsubscribe;
  const lines = input.items.map((i) => `• ${i.title}${i.body ? `\n  ${i.body}` : ''}\n  ${input.origin}${i.url}`).join('\n\n');
  return {
    to: input.to,
    subject,
    headers: unsubscribeHeaders(stop),
    text: `Il riassunto di oggi su giro.shop\n\n${lines}\n\nTutti i tuoi avvisi: ${all}\n\n— giro.shop\nCambia quando e per cosa ricevi email: ${prefs}${stop ? `\nNon voglio più email: ${stop}` : ''}`,
    html: emailLayout({
      origin: input.origin,
      preheader: n === 1 ? input.items[0].title : `${n} avvisi che non hai ancora visto`,
      body:
        label('Il riassunto di oggi') +
        heading(n === 1 ? '1 avviso che non hai ancora visto' : `${n} avvisi che non hai ancora visto`) +
        rows(
          input.items.map((i) => ({
            url: `${input.origin}${i.url}`,
            kind: kindOf(i.kind).label,
            title: i.title,
            // Il prezzo in evidenza solo dove è la notizia
            price: i.listing && i.kind === 'prezzo' ? i.listing.price : null,
            detail: i.body,
            photo: i.listing?.photo ?? null,
          })),
        ) +
        button(all, 'Tutti i tuoi avvisi'),
      footer:
        `Ricevi un riassunto al giorno, alle 18. ${footLink(prefs, 'Cambia quando e per cosa')}` +
        (stop ? ` · ${footLink(esc(stop), 'Non voglio più email')}` : ''),
    }),
  };
}
