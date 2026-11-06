import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Link per spegnere le email degli avvisi senza accedere: l'id della persona firmato
 * con la chiave segreta del server, così nessuno può spegnere le email di altri.
 */
function secret(): string | undefined {
  return import.meta.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
}

export function unsubscribeToken(userId: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac('sha256', key).update(`email-avvisi:${userId}`).digest('base64url').slice(0, 32);
}

export function unsubscribeUrl(origin: string, userId: string): string | null {
  const token = unsubscribeToken(userId);
  return token ? `${origin}/email-avvisi?u=${encodeURIComponent(userId)}&t=${token}` : null;
}

export function validUnsubscribe(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId);
  if (!expected || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
