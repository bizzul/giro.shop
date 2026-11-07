import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

/** Indirizzo pubblico di Supabase: quello che vedono i browser (foto, link nelle email). */
export const SUPABASE_URL: string | undefined = import.meta.env?.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
/**
 * Indirizzo che usa il server per parlare con Supabase. Dietro un tunnel (Mac mini + Cloudflare) è quello interno,
 * es. http://127.0.0.1:54421, così le query non fanno il giro di internet; senza SUPABASE_INTERNAL_URL è quello pubblico.
 */
export const SUPABASE_SERVER_URL: string | undefined = import.meta.env?.SUPABASE_INTERNAL_URL ?? process.env.SUPABASE_INTERNAL_URL ?? SUPABASE_URL;
export const SUPABASE_KEY: string | undefined = import.meta.env?.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

let passkeyCheck: { on: boolean; at: number } | null = null;

/**
 * true se Supabase Auth accetta le passkey ([auth.passkey] in supabase/config.toml). Letto da /auth/v1/settings
 * e tenuto 5 minuti: senza, /accedi e l'account non mostrano niente sulle passkey.
 */
export async function passkeysEnabled(): Promise<boolean> {
  if (!SUPABASE_SERVER_URL || !SUPABASE_KEY) return false;
  if (passkeyCheck && Date.now() - passkeyCheck.at < 5 * 60_000) return passkeyCheck.on;
  try {
    const res = await fetch(`${SUPABASE_SERVER_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY }, signal: AbortSignal.timeout(3000) });
    const settings = res.ok ? ((await res.json()) as { passkeys_enabled?: boolean }) : null;
    passkeyCheck = { on: settings?.passkeys_enabled === true, at: Date.now() };
  } catch {
    // Supabase non risponde: si riprova alla prossima richiesta, intanto niente passkey
    return false;
  }
  return passkeyCheck.on;
}

/**
 * Client Supabase legato alla richiesta: legge la sessione dai cookie e scrive i cookie
 * aggiornati (accesso, rinnovo, uscita). Le query rispettano le regole RLS dell'utente.
 */
export function createRequestClient(request: Request, cookies: AstroCookies, onHeaders?: (headers: Record<string, string>) => void) {
  if (!SUPABASE_SERVER_URL || !SUPABASE_KEY) return null;
  return createServerClient(SUPABASE_SERVER_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(({ name, value }) => ({ name, value: value ?? '' }));
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, options as Parameters<AstroCookies['set']>[2]);
        }
        onHeaders?.(headers);
      },
    },
  });
}
