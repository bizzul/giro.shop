import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

export const SUPABASE_URL: string | undefined = import.meta.env.PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY: string | undefined = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Client Supabase legato alla richiesta: legge la sessione dai cookie e scrive i cookie
 * aggiornati (accesso, rinnovo, uscita). Le query rispettano le regole RLS dell'utente.
 */
export function createRequestClient(request: Request, cookies: AstroCookies, onHeaders?: (headers: Record<string, string>) => void) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
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
