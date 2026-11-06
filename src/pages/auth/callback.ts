import type { APIRoute } from 'astro';
import { safeNext } from '../../actions/account.ts';

/** Ritorno dal link email: scambia il codice con una sessione (PKCE) e porta l'utente dove voleva andare. */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code && locals.supabase) {
    const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirect(next, 303);
  }
  return redirect(`/accedi?errore=1&next=${encodeURIComponent(next)}`, 303);
};
