import type { APIRoute } from 'astro';
import { safeNext } from '../../actions/account.ts';
import { passkeysEnabled } from '../../lib/supabase.ts';

/** Ritorno dal link email: scambia il codice con una sessione (PKCE) e porta l'utente dove voleva andare. */
export const GET: APIRoute = async ({ url, locals, redirect, cookies }) => {
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code && locals.supabase) {
    const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Chi non ha ancora una passkey se la vede proporre nella pagina dove arriva (components/PasskeyOffer.astro)
      if (await passkeysEnabled()) {
        const { data } = await locals.supabase.auth.passkey.list();
        if (!data?.length) cookies.set('giro_offri_passkey', '1', { path: '/', maxAge: 600, sameSite: 'lax', secure: url.protocol === 'https:' });
      }
      return redirect(next, 303);
    }
  }
  return redirect(`/accedi?errore=1&next=${encodeURIComponent(next)}`, 303);
};
