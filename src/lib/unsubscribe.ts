import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Link per spegnere le email degli avvisi (tutte o di un tipo) senza accedere: l'id della persona firmato
 * con la chiave segreta del server, così nessuno può spegnere le email di altri.
 */
function secret(): string | undefined {
  return import.meta.env?.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
}

export function unsubscribeToken(userId: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac('sha256', key).update(`email-avvisi:${userId}`).digest('base64url').slice(0, 32);
}

/** Con `group` il link spegne solo quel tipo di avviso (vedi EMAIL_GROUPS); senza, tutte le email. */
export function unsubscribeUrl(origin: string, userId: string, group?: string): string | null {
  const token = unsubscribeToken(userId);
  if (!token) return null;
  return `${origin}/email-avvisi?u=${encodeURIComponent(userId)}&t=${token}${group ? `&tipo=${encodeURIComponent(group)}` : ''}`;
}

export function validUnsubscribe(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId);
  if (!expected || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
