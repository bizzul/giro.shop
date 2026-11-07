/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly SUPABASE_INTERNAL_URL?: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly PIAZZA_BASE_URL?: string;
}

declare namespace App {
  interface Locals {
    /** Client Supabase con la sessione dell'utente; null sulle pagine pubbliche o senza Supabase. */
    supabase: import('@supabase/supabase-js').SupabaseClient | null;
    user: { id: string; email?: string } | null;
  }
}
