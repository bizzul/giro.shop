import type { APIRoute } from 'astro';
import { PRO_PLANS, type ProPlan } from '../../core/pricing.ts';
import { invalidateListingPages } from '../../lib/cache.ts';
import { siteOrigin } from '../../lib/notify.ts';
import { PaymentError, safeReturn } from '../../lib/payments.ts';
import { startPurchase, type Purchase } from '../../lib/purchases.ts';

/**
 * Avvia un acquisto da un modulo (Pro, vetrina, pubblicazione, pagamento protetto) e porta alla pagina di pagamento.
 * Il modulo dice solo cosa si compra; l'importo lo decide il server. In caso di problemi si torna indietro con ?errore=.
 */
export const POST: APIRoute = async (context) => {
  const { request, locals, url, redirect } = context;
  const form = await request.formData();
  const back = safeReturn(form.get('back'), '/').split('#')[0];
  if (!locals.user) return redirect(`/accedi?next=${encodeURIComponent(back)}`, 303);

  const field = (name: string) => String(form.get(name) ?? '').trim();
  const kind = field('kind');
  let purchase: Purchase | null = null;
  if (kind === 'pro' && field('plan') in PRO_PLANS) purchase = { kind: 'pro', plan: field('plan') as ProPlan };
  if ((kind === 'vetrina' || kind === 'annuncio') && field('listingId')) purchase = { kind, listingId: field('listingId') };
  if (kind === 'protetto' && /^[0-9a-f-]{36}$/i.test(field('conversationId'))) purchase = { kind: 'protetto', conversationId: field('conversationId') };
  const fail = (message: string) => redirect(`${back}${back.includes('?') ? '&' : '?'}errore=${encodeURIComponent(message)}`, 303);
  if (!purchase) return fail('Acquisto non valido.');

  try {
    return redirect(await startPurchase(locals.user.id, purchase, siteOrigin(url.origin), () => invalidateListingPages(context)), 303);
  } catch (error) {
    if (error instanceof PaymentError) return fail(error.message);
    throw error;
  }
};
