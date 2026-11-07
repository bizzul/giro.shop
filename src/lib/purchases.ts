import { getListing, refreshListings } from '../core/store.ts';
import { getComune } from '../core/comuni.ts';
import { formatChf, formatDay } from '../core/format.ts';
import { matchesSearch } from '../core/search.ts';
import { listingFee, PRO_PLANS, VETRINA, type ProPlan } from '../core/pricing.ts';
import { adminClient } from './admin.ts';
import { savedSearches } from './demand.ts';
import { afterPublish } from './listing-events.ts';
import { notify, type Notice } from './notify.ts';
import { similaritiesFor } from './semantic.ts';
import { createPayment, getPayment, moveStatus, PaymentError, safeReturn, type Payment } from './payments.ts';
import { holdProtected, startProtected } from './protected.ts';

/**
 * Cosa si compra e cosa succede dopo il pagamento: Pro, vetrina mirata, pubblicazione a pagamento,
 * pagamento protetto. Prezzi da core/pricing.ts, mai dal modulo.
 */

type Invalidate = () => Promise<void>;

export type Purchase =
  | { kind: 'pro'; plan: ProPlan }
  | { kind: 'vetrina'; listingId: string }
  | { kind: 'annuncio'; listingId: string }
  | { kind: 'protetto'; conversationId: string };

/** Crea il pagamento giusto e restituisce dove andare a pagarlo (o, se non serve pagare, dove andare). */
export async function startPurchase(userId: string, p: Purchase, origin: string, invalidate: Invalidate): Promise<string> {
  const admin = adminClient();
  if (!admin) throw new PaymentError('Pagamenti non disponibili: manca la configurazione del server.');

  if (p.kind === 'pro') {
    const plan = PRO_PLANS[p.plan];
    return (await createPayment({ userId, kind: 'pro', amountChf: plan.chf, description: `giro.shop Pro, ${plan.label.toLowerCase()}`, metadata: { plan: p.plan }, returnUrl: '/pro?fatto=attivo' })).url;
  }

  if (p.kind === 'protetto') return startProtected(userId, p.conversationId);

  const { data: row } = await admin.from('listings').select('id, title, status, category_id, seller_id, hidden_at').eq('id', p.listingId).maybeSingle();
  if (!row || row.seller_id !== userId) throw new PaymentError('Annuncio non trovato tra i tuoi.');

  if (p.kind === 'vetrina') {
    if (!['pubblicato', 'in_trattativa'].includes(row.status) || row.hidden_at) throw new PaymentError('Va in vetrina solo un annuncio in vendita.');
    const until = getListing(row.id)?.promotedUntil;
    if (until && new Date(until) > new Date()) throw new PaymentError(`È già in vetrina fino ${formatDay(until, 'al')}.`);
    return (
      await createPayment({
        userId,
        kind: 'vetrina',
        amountChf: VETRINA.chf,
        description: `Vetrina mirata per ${VETRINA.days} giorni: «${row.title}»`,
        listingId: row.id,
        returnUrl: `/miei-annunci?fatto=vetrina#a-${row.id}`,
      })
    ).url;
  }

  // Pubblicazione a pagamento: un negozio Pro pubblica gratis
  const fee = listingFee(row.category_id);
  if (row.status !== 'bozza') throw new PaymentError('Si paga la pubblicazione solo di una bozza.');
  if (!fee) throw new PaymentError('In questa categoria si pubblica gratis.');
  const { data: pro } = await admin.rpc('is_pro', { p_user: userId });
  if (pro) {
    await publishPaid(row.id, userId, origin, invalidate);
    return `/annuncio/${row.id}`;
  }
  return (
    await createPayment({
      userId,
      kind: 'annuncio',
      amountChf: fee,
      description: `Pubblicazione per 90 giorni: «${row.title}»`,
      listingId: row.id,
      returnUrl: `/annuncio/${row.id}`,
    })
  ).url;
}

/** Il bottone "Paga" della pagina di prova: segna il pagamento e attiva ciò che si è comprato. */
export async function confirmPurchase(paymentId: string, userId: string, origin: string, invalidate: Invalidate): Promise<string> {
  const payment = await getPayment(paymentId);
  if (!payment || payment.user_id !== userId) throw new PaymentError('Pagamento non trovato.');
  const done = safeReturn(payment.metadata.returnUrl);
  if (payment.status !== 'in_attesa') return done;
  const paidAt = new Date().toISOString();
  const moved = await moveStatus(payment.id, ['in_attesa'], payment.kind === 'protetto' ? 'trattenuto' : 'pagato', {
    paid_at: paidAt,
    provider_ref: `prova-${crypto.randomUUID().slice(0, 8)}`,
  });
  if (!moved) return done;
  await fulfill({ ...payment, paid_at: paidAt }, origin, invalidate);
  return done;
}

export async function cancelPurchase(paymentId: string, userId: string): Promise<string> {
  const payment = await getPayment(paymentId);
  if (!payment || payment.user_id !== userId) throw new PaymentError('Pagamento non trovato.');
  await moveStatus(payment.id, ['in_attesa'], 'annullato');
  return safeReturn(payment.metadata.returnUrl);
}

async function fulfill(payment: Payment, origin: string, invalidate: Invalidate): Promise<void> {
  if (payment.kind === 'pro') await activatePro(payment.user_id, (payment.metadata.plan as ProPlan) ?? 'anno');
  else if (payment.kind === 'vetrina' && payment.listing_id) await activateVetrina(payment, origin, invalidate);
  else if (payment.kind === 'annuncio' && payment.listing_id) await publishPaid(payment.listing_id, payment.user_id, origin, invalidate);
  else if (payment.kind === 'protetto') await holdProtected(payment, origin, invalidate);
}

/** Pro: il negozio resta attivo un mese o un anno in più (da oggi, o dalla scadenza se è ancora attivo). */
export async function activatePro(userId: string, plan: ProPlan): Promise<string> {
  const admin = adminClient()!;
  const [{ data: shop }, { data: profile }] = await Promise.all([
    admin.from('shops').select('active_until').eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('display_name').eq('id', userId).single(),
  ]);
  const from = shop?.active_until && new Date(shop.active_until) > new Date() ? new Date(shop.active_until) : new Date();
  const until = new Date(from);
  until.setMonth(until.getMonth() + PRO_PLANS[plan].months);
  const { error } = shop
    ? await admin.from('shops').update({ active_until: until.toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId)
    : await admin.from('shops').insert({ user_id: userId, name: (profile?.display_name ?? 'Il mio negozio').slice(0, 60).padEnd(2, '.'), active_until: until.toISOString() });
  if (error) throw new PaymentError(`Pro non attivato: ${error.message}`);
  await refreshListings(true);
  return until.toISOString();
}

/** Chi ha una ricerca salvata che corrisponde all'annuncio (a qualsiasi prezzo), escluso chi vende. */
export async function vetrinaAudience(listingId: string): Promise<Array<{ userId: string; query: string }>> {
  const listing = getListing(listingId);
  if (!listing) return [];
  const searches = await savedSearches();
  const sims = await similaritiesFor(searches.map((s) => s.query), [listingId]).catch(() => new Map<string, Map<string, number>>());
  const byUser = new Map<string, string>();
  for (const s of searches) {
    if (s.userId === listing.sellerId || byUser.has(s.userId)) continue;
    if (matchesSearch(s.query, listing, sims.get(s.query)?.get(listingId), { ignorePrice: true })) byUser.set(s.userId, s.query);
  }
  return [...byUser].map(([userId, query]) => ({ userId, query }));
}

async function activateVetrina(payment: Payment, origin: string, invalidate: Invalidate): Promise<void> {
  const admin = adminClient()!;
  const listingId = payment.listing_id!;
  const ends = new Date(Date.now() + VETRINA.days * 864e5).toISOString();
  const { data: promo, error } = await admin
    .from('promotions')
    .insert({ listing_id: listingId, user_id: payment.user_id, payment_id: payment.id, ends_at: ends })
    .select('id')
    .single();
  if (error || !promo) throw new PaymentError(`Vetrina non attivata: ${error?.message}`);
  await refreshListings(true);
  await invalidate();

  // Avviso a chi lo cerca, tranne chi l'ha già ricevuto per questo annuncio
  const listing = getListing(listingId);
  if (!listing) return;
  const audience = await vetrinaAudience(listingId);
  const { data: already } = await admin.from('notifications').select('user_id').eq('listing_id', listingId).eq('kind', 'ricerca');
  const skip = new Set((already ?? []).map((n) => n.user_id as string));
  const notices: Notice[] = audience
    .filter((a) => !skip.has(a.userId))
    .map((a) => ({
      userId: a.userId,
      kind: 'ricerca',
      title: `Per la tua ricerca «${a.query}»: ${listing.title}`,
      body: [formatChf(listing.priceChf), getComune(listing.comuneId)?.name, 'in vetrina'].filter(Boolean).join(' · '),
      url: `/annuncio/${listing.id}`,
      listingId: listing.id,
    }));
  if (notices.length) await notify(notices, origin);
  await admin.from('promotions').update({ notified: notices.length }).eq('id', promo.id);
}

/** Pubblica una bozza in una categoria a pagamento (il trigger del database controlla che sia pagata o Pro). */
async function publishPaid(listingId: string, userId: string, origin: string, invalidate: Invalidate): Promise<void> {
  const admin = adminClient()!;
  const { data: photos } = await admin.from('listing_photos').select('id').eq('listing_id', listingId).limit(1);
  if (!photos?.length) return; // senza foto resta in bozza: la pubblica chi vende dopo aver aggiunto la foto
  const { error } = await admin.from('listings').update({ status: 'pubblicato' }).eq('id', listingId).eq('seller_id', userId).eq('status', 'bozza');
  if (error) throw new PaymentError(`Annuncio non pubblicato: ${error.message}`);
  await refreshListings(true);
  await invalidate();
  afterPublish(listingId, origin, invalidate);
}
