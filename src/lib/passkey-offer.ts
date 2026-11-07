import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { passkeysEnabled } from './supabase.ts';

/**
 * Dopo un accesso con link o codice: chi non ha ancora una passkey se la vede proporre nella pagina dove arriva
 * (components/PasskeyOffer.astro legge questo cookie, una volta sola).
 */
export async function markPasskeyOffer(supabase: SupabaseClient, cookies: AstroCookies, secure: boolean): Promise<void> {
  if (!(await passkeysEnabled())) return;
  const { data } = await supabase.auth.passkey.list();
  if (!data?.length) cookies.set('giro_offri_passkey', '1', { path: '/', maxAge: 600, sameSite: 'lax', secure });
}
