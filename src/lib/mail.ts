import nodemailer, { type Transporter } from 'nodemailer';

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

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const MUTED = 'margin:28px 0 0;font-size:12px;line-height:1.5;color:#6b6b68';

function shell(inner: string): string {
  return `<!doctype html><html lang="it"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:28px">
<p style="margin:0 0 20px;font-size:13px;color:#6b6b68">giro.shop</p>
${inner}
</div></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${escape(href)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:2px;font-size:13px;letter-spacing:.06em;text-transform:uppercase">${escape(label)}</a>`;

/** Disiscrizione con un clic dal programma di posta (RFC 8058) */
const unsubscribeHeaders = (stop: string | null) =>
  stop ? { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;

/**
 * Email semplice e leggibile anche senza immagini: titolo, testo, un bottone, i link per le preferenze.
 * `about` è il tipo di avviso ("Valutazioni che ricevi"): il link in fondo spegne solo quello.
 */
export function noticeMail(input: { to: string; title: string; body: string; url: string; origin: string; unsubscribe: string | null; about?: string }): Mail {
  const link = `${input.origin}${input.url}`;
  const prefs = `${input.origin}/miei-annunci#email`;
  const stop = input.unsubscribe;
  const stopLabel = input.about ? 'Non voglio più queste email' : 'Non voglio più email';
  return {
    to: input.to,
    subject: input.title,
    headers: unsubscribeHeaders(stop),
    text: `${input.title}\n\n${input.body}\n\nApri: ${link}\n\n— giro.shop\n${input.about ? `Ricevi questa email per: ${input.about}.\n` : ''}Preferisci un riassunto al giorno o meno email? ${prefs}${stop ? `\n${stopLabel}: ${stop}` : ''}`,
    html: shell(`<h1 style="margin:0 0 12px;font-size:20px;font-weight:500;line-height:1.3">${escape(input.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#333">${escape(input.body)}</p>
${button(link, 'Apri')}
<p style="${MUTED}">${input.about ? `Ricevi questa email per: ${escape(input.about.toLowerCase())}. ` : ''}<a href="${escape(prefs)}" style="color:#6b6b68">Un riassunto al giorno, o meno email</a>${stop ? ` · <a href="${escape(stop)}" style="color:#6b6b68">${stopLabel}</a>` : ''}</p>`),
  };
}

export interface DigestItem {
  title: string;
  body: string;
  url: string;
}

/** Il riassunto della sera: tutti gli avvisi del giorno non ancora visti, in una email. */
export function digestMail(input: { to: string; items: DigestItem[]; origin: string; unsubscribe: string | null }): Mail {
  const n = input.items.length;
  const subject = n === 1 ? `Il riassunto di oggi: ${input.items[0].title}` : `Il riassunto di oggi: ${n} avvisi`;
  const all = `${input.origin}/avvisi`;
  const prefs = `${input.origin}/miei-annunci#email`;
  const stop = input.unsubscribe;
  const lines = input.items.map((i) => `• ${i.title}${i.body ? `\n  ${i.body}` : ''}\n  ${input.origin}${i.url}`).join('\n\n');
  const rows = input.items
    .map(
      (i) => `<li style="margin:0;padding:14px 0;border-top:1px solid #e6e6e2">
<a href="${escape(input.origin + i.url)}" style="color:#111;text-decoration:none;font-size:15px;font-weight:500;line-height:1.35">${escape(i.title)}</a>
${i.body ? `<p style="margin:4px 0 0;font-size:14px;line-height:1.45;color:#555">${escape(i.body)}</p>` : ''}</li>`,
    )
    .join('');
  return {
    to: input.to,
    subject,
    headers: unsubscribeHeaders(stop),
    text: `Il riassunto di oggi su giro.shop\n\n${lines}\n\nTutti i tuoi avvisi: ${all}\n\n— giro.shop\nCambia quando e per cosa ricevi email: ${prefs}${stop ? `\nNon voglio più email: ${stop}` : ''}`,
    html: shell(`<h1 style="margin:0 0 8px;font-size:20px;font-weight:500;line-height:1.3">Il riassunto di oggi</h1>
<p style="margin:0 0 16px;font-size:14px;color:#555">${n === 1 ? '1 avviso' : `${n} avvisi`} che non hai ancora visto.</p>
<ul style="list-style:none;margin:0 0 24px;padding:0">${rows}</ul>
${button(all, 'Tutti i tuoi avvisi')}
<p style="${MUTED}">Ricevi un riassunto al giorno, alle 18. <a href="${escape(prefs)}" style="color:#6b6b68">Cambia quando e per cosa</a>${stop ? ` · <a href="${escape(stop)}" style="color:#6b6b68">Non voglio più email</a>` : ''}</p>`),
  };
}
