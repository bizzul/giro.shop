import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' }));
export const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const MAILPIT = status.INBUCKET_URL ?? status.MAILPIT_URL ?? 'http://127.0.0.1:54324';

/** Una casella email temporanea per i test, diversa a ogni esecuzione. */
export const testEmail = (name: string) => `e2e-${name}-${Date.now().toString(36)}@esempio.test`;

/** Il link di accesso arrivato a `email` (Mailpit), aspettandolo fino a 15 secondi. */
async function magicLink(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: Array<{ ID: string }> };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Text: string };
      const link = (msg.HTML + msg.Text).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/)?.[0];
      if (link) return link.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nessuna email di accesso per ${email}`);
}

/** Il codice a 6 cifre dell'ultima email di accesso arrivata a `email` (Mailpit), aspettandolo fino a 15 secondi. */
export async function accessCode(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: Array<{ ID: string }> };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
      const code = msg.HTML.match(/>\s*(\d{6})\s*</)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nessun codice di accesso per ${email}`);
}

/** Accesso vero: email in /accedi, link da Mailpit aperto nello stesso browser (PKCE). */
export async function login(page: Page, email: string, next = '/miei-annunci') {
  await page.goto(`/accedi?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Mandami il link' }).click();
  await expect(page.getByRole('heading', { name: 'Ti abbiamo mandato un link.' })).toBeVisible();
  await page.goto(await magicLink(email));
  await page.waitForURL((url) => url.pathname === next.split('?')[0] || url.pathname === next.split('#')[0]);
}

/** Cancella gli utenti creati dai test (e con loro, a cascata, i loro dati). */
export async function deleteUsers(emails: string[]) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users.filter((u) => u.email && emails.includes(u.email))) await admin.auth.admin.deleteUser(u.id);
}
