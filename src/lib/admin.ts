import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVER_URL } from './supabase.ts';

let admin: SupabaseClient | null | undefined;

/**
 * Client con la chiave segreta: solo sul server e ignora le regole RLS.
 * Serve dove il server agisce per conto di altri: avvisi (ricerche salvate, salvati), email, traduzioni.
 */
export function adminClient(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const key = import.meta.env?.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
  admin = SUPABASE_SERVER_URL && key ? createClient(SUPABASE_SERVER_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  if (!admin) console.warn('[giro] SUPABASE_SECRET_KEY mancante: avvisi, email e traduzioni sono spenti.');
  return admin;
}
