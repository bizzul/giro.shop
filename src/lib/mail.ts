import nodemailer, { type Transporter } from 'nodemailer';

let transport: Transporter | null | undefined;

function transporter(): Transporter | null {
  if (transport !== undefined) return transport;
  const host = import.meta.env.SMTP_HOST ?? process.env.SMTP_HOST;
  const port = Number(import.meta.env.SMTP_PORT ?? process.env.SMTP_PORT ?? 587);
  const user = import.meta.env.SMTP_USER ?? process.env.SMTP_USER;
  const pass = import.meta.env.SMTP_PASS ?? process.env.SMTP_PASS;
  transport = host ? nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined }) : null;
  return transport;
}

export function mailFrom(): string {
  return import.meta.env.MAIL_FROM ?? process.env.MAIL_FROM ?? 'giro.shop <avvisi@giro.shop>';
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Manda un'email. Restituisce false (senza eccezioni) se l'invio non è configurato o non riesce. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const t = transporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: mailFrom(), ...mail });
    return true;
  } catch (error) {
    console.warn(`[giro] email a ${mail.to} non inviata: ${(error as Error).message}`);
    return false;
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Email semplice e leggibile anche senza immagini: titolo, testo, un bottone, il link agli avvisi. */
export function noticeMail(input: { to: string; title: string; body: string; url: string; origin: string }): Mail {
  const link = `${input.origin}${input.url}`;
  const manage = `${input.origin}/avvisi`;
  return {
    to: input.to,
    subject: input.title,
    text: `${input.title}\n\n${input.body}\n\nApri: ${link}\n\n— giro.shop\nTutti i tuoi avvisi: ${manage}`,
    html: `<!doctype html><html lang="it"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:28px">
<p style="margin:0 0 20px;font-size:13px;color:#6b6b68">giro.shop</p>
<h1 style="margin:0 0 12px;font-size:20px;font-weight:500;line-height:1.3">${escape(input.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#333">${escape(input.body)}</p>
<a href="${escape(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:2px;font-size:13px;letter-spacing:.06em;text-transform:uppercase">Apri</a>
<p style="margin:28px 0 0;font-size:12px;color:#6b6b68">Ricevi questa email per un avviso che hai attivato. <a href="${escape(manage)}" style="color:#6b6b68">Tutti i tuoi avvisi</a></p>
</div></body></html>`,
  };
}
