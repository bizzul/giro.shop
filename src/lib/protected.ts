import { getListing, refreshListings } from '../core/store.ts';
import { formatChf } from '../core/format.ts';
import { protectedFee, roundRappen } from '../core/pricing.ts';
import { adminClient } from './admin.ts';
import { afterSale } from './listing-events.ts';
import { notify } from './notify.ts';
import { createPayment, moveStatus, PaymentError, type Payment } from './payments.ts';

/**
 * Pagamento protetto tra privati: chi compra paga sul sito, i soldi restano fermi finché conferma
 * di aver ricevuto l'oggetto; poi vanno a chi vende. Commissione a carico di chi compra (core/pricing.ts).
 *
 * Spento online finché non c'è il parere di un giurista (legge sul riciclaggio): si accende con
 * PIAZZA_PAGAMENTO_PROTETTO=on. In sviluppo è sempre acceso, per provarlo. Per ora i soldi sono "di prova".
 */

export function protectedPaymentsOn(): boolean {
  const flag = import.meta.env?.PIAZZA_PAGAMENTO_PROTETTO ?? process.env.PIAZZA_PAGAMENTO_PROTETTO;
  return flag === 'on' || Boolean(import.meta.env?.DEV);
}

/** Quanto si paga: l'offerta accettata nella conversazione, altrimenti il prezzo dell'annuncio. */
export async function protectedQuote(conversationId: string): Promise<{ itemChf: number; feeChf: number; totalChf: number } | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data: conv } = await admin.from('conversations').select('listing_id').eq('id', conversationId).maybeSingle();
  const listing = conv ? getListing(conv.listing_id) : undefined;
  if (!listing) return null;
  const { data: offer } = await admin
    .from('messages')
    .select('offer_chf')
    .eq('conversation_id', conversationId)
    .eq('kind', 'offerta')
    .eq('offer_status', 'accettata')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const itemChf = offer ? Number(offer.offer_chf) : listing.priceChf;
  if (!(itemChf > 0)) return null;
  const feeChf = protectedFee(itemChf);
  return { itemChf, feeChf, totalChf: roundRappen(itemChf + feeChf) };
}

export async function startProtected(userId: string, conversationId: string): Promise<string> {
  if (!protectedPaymentsOn()) throw new PaymentError('Il pagamento protetto non è ancora attivo.');
  const admin = adminClient()!;
  const { data: conv } = await admin.from('conversations').select('id, listing_id, buyer_id, seller_id').eq('id', conversationId).maybeSingle();
  if (!conv || conv.buyer_id !== userId) throw new PaymentError('Paga con il pagamento protetto solo chi compra.');
  const listing = getListing(conv.listing_id);
  if (!listing || listing.status !== 'pubblicato') throw new PaymentError("L'annuncio non è più in vendita.");
  const { data: open } = await admin
    .from('payments')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('kind', 'protetto')
    .in('status', ['trattenuto', 'contestato'])
    .limit(1);
  if (open?.length) throw new PaymentError("C'è già un pagamento protetto per questa conversazione.");
  const quote = await protectedQuote(conversationId);
  if (!quote) throw new PaymentError('Per un regalo non serve pagare.');
  return (
    await createPayment({
      userId,
      kind: 'protetto',
      amountChf: quote.totalChf,
      feeChf: quote.feeChf,
      description: `Pagamento protetto: «${listing.title}»`,
      listingId: listing.id,
      conversationId,
      payeeId: conv.seller_id,
      metadata: { itemChf: quote.itemChf },
      returnUrl: `/messaggi/${conversationId}#fondo`,
    })
  ).url;
}

const itemOf = (p: Payment) => Number(p.metadata.itemChf ?? p.amount_chf - p.fee_chf);

async function systemMessage(p: Payment, body: string): Promise<void> {
  if (!p.conversation_id) return;
  await adminClient()!.from('messages').insert({ conversation_id: p.conversation_id, sender_id: p.user_id, kind: 'sistema', body });
}

/** Dopo il pagamento: soldi trattenuti, annuncio in trattativa, chi vende avvisato. */
export async function holdProtected(p: Payment, origin: string, invalidate: () => Promise<void>): Promise<void> {
  const admin = adminClient()!;
  const listing = p.listing_id ? getListing(p.listing_id) : undefined;
  if (p.listing_id) await admin.from('listings').update({ status: 'in_trattativa' }).eq('id', p.listing_id).eq('status', 'pubblicato');
  await systemMessage(
    p,
    `Pagamento protetto: ${formatChf(itemOf(p))} trattenuti da giro.shop. Chi vende li riceve quando chi compra conferma di aver ricevuto l'oggetto.`,
  );
  if (p.payee_id) {
    await notify(
      [
        {
          userId: p.payee_id,
          kind: 'pagamento',
          title: `Pagamento protetto per «${listing?.title ?? 'il tuo annuncio'}»`,
          body: `${formatChf(itemOf(p))} sono trattenuti per te: li ricevi quando chi compra conferma di aver ricevuto l'oggetto.`,
          url: `/messaggi/${p.conversation_id}`,
          listingId: p.listing_id ?? undefined,
        },
      ],
      origin,
    );
  }
  await refreshListings(true);
  await invalidate();
}

async function load(paymentId: string): Promise<Payment> {
  const { data } = await adminClient()!.from('payments').select('*').eq('id', paymentId).eq('kind', 'protetto').maybeSingle();
  if (!data) throw new PaymentError('Pagamento non trovato.');
  return { ...data, amount_chf: Number(data.amount_chf), fee_chf: Number(data.fee_chf) } as Payment;
}

/** Chi compra conferma (o passano i giorni): i soldi vanno a chi vende e l'annuncio è venduto. */
export async function releaseProtected(paymentId: string, by: { userId: string } | 'automatico', origin: string, invalidate: () => Promise<void>): Promise<void> {
  const admin = adminClient()!;
  const p = await load(paymentId);
  if (by !== 'automatico' && by.userId !== p.user_id) throw new PaymentError('Conferma la consegna solo chi ha pagato.');
  if (!(await moveStatus(p.id, ['trattenuto'], 'rilasciato'))) throw new PaymentError('Questo pagamento non è più trattenuto.');
  const before = p.listing_id ? getListing(p.listing_id) : undefined;
  if (p.listing_id) {
    await admin.from('listings').update({ status: 'venduto', sold_price_chf: itemOf(p), buyer_id: p.user_id }).eq('id', p.listing_id).in('status', ['pubblicato', 'in_trattativa']);
  }
  if (p.conversation_id) await admin.from('conversations').update({ pickup_outcome: 'venduto' }).eq('id', p.conversation_id);
  await systemMessage(
    p,
    by === 'automatico'
      ? `Nessun problema segnalato: il pagamento protetto di ${formatChf(itemOf(p))} è andato a chi vende.`
      : `Consegna confermata: il pagamento protetto di ${formatChf(itemOf(p))} è andato a chi vende.`,
  );
  if (p.payee_id) {
    await notify(
      [{ userId: p.payee_id, kind: 'pagamento', title: `Pagamento rilasciato: ${formatChf(itemOf(p))}`, body: `Per «${before?.title ?? "l'annuncio"}». È un pagamento di prova: nessun soldo vero.`, url: `/messaggi/${p.conversation_id}`, listingId: p.listing_id ?? undefined }],
      origin,
    );
  }
  await refreshListings(true);
  await invalidate();
  if (before) {
    const { data: buyer } = await admin.from('profiles').select('display_name').eq('id', p.user_id).maybeSingle();
    await afterSale(before, p.user_id, buyer?.display_name ?? null, origin);
  }
}

/** Chi compra segnala un problema: i soldi restano fermi e decide chi modera. */
export async function disputeProtected(paymentId: string, userId: string, reason: string, origin: string): Promise<void> {
  const p = await load(paymentId);
  if (userId !== p.user_id) throw new PaymentError('Segnala un problema solo chi ha pagato.');
  if (!(await moveStatus(p.id, ['trattenuto'], 'contestato', { metadata: { ...p.metadata, dispute: reason.slice(0, 500) } }))) {
    throw new PaymentError('Questo pagamento non è più trattenuto.');
  }
  await systemMessage(p, `Chi compra ha segnalato un problema: il pagamento resta fermo finché chi modera non decide. «${reason.slice(0, 200)}»`);
  if (p.payee_id) {
    await notify([{ userId: p.payee_id, kind: 'pagamento', title: 'Problema segnalato su un pagamento protetto', body: reason.slice(0, 200), url: `/messaggi/${p.conversation_id}`, listingId: p.listing_id ?? undefined }], origin);
  }
}

/** Rimborso: lo chiede chi vende (non può consegnare) o lo decide chi modera. L'annuncio torna in vendita. */
export async function refundProtected(paymentId: string, by: { userId: string } | 'moderazione', origin: string, invalidate: () => Promise<void>): Promise<void> {
  const admin = adminClient()!;
  const p = await load(paymentId);
  if (by !== 'moderazione' && by.userId !== p.payee_id) throw new PaymentError('Rimborsa solo chi vende.');
  const from: Payment['status'][] = by === 'moderazione' ? ['trattenuto', 'contestato'] : ['trattenuto'];
  if (!(await moveStatus(p.id, from, 'rimborsato'))) throw new PaymentError('Questo pagamento non si può più rimborsare.');
  if (p.listing_id) await admin.from('listings').update({ status: 'pubblicato' }).eq('id', p.listing_id).eq('status', 'in_trattativa');
  await systemMessage(p, `Pagamento protetto rimborsato: ${formatChf(p.amount_chf)} tornano a chi ha pagato. L'annuncio è di nuovo in vendita.`);
  await notify([{ userId: p.user_id, kind: 'pagamento', title: `Rimborso di ${formatChf(p.amount_chf)}`, body: 'È un pagamento di prova: nessun soldo vero.', url: `/messaggi/${p.conversation_id}`, listingId: p.listing_id ?? undefined }], origin);
  await refreshListings(true);
  await invalidate();
}

/** Chi modera chiude una contestazione dando i soldi a chi vende. */
export async function resolveForSeller(paymentId: string, origin: string, invalidate: () => Promise<void>): Promise<void> {
  if (!(await moveStatus(paymentId, ['contestato'], 'trattenuto'))) throw new PaymentError('Questo pagamento non è contestato.');
  await releaseProtected(paymentId, 'automatico', origin, invalidate);
}

/** Dalla manutenzione: senza problemi segnalati, i soldi vanno a chi vende 2 giorni dopo il ritiro (o 14 dopo il pagamento). */
export async function autoReleaseProtected(origin: string, invalidate: () => Promise<void>, now = new Date()): Promise<number> {
  const admin = adminClient();
  if (!admin) return 0;
  const { data } = await admin.from('payments').select('id, paid_at, conversation_id').eq('kind', 'protetto').eq('status', 'trattenuto');
  let n = 0;
  for (const p of data ?? []) {
    const { data: conv } = p.conversation_id ? await admin.from('conversations').select('pickup_at').eq('id', p.conversation_id).maybeSingle() : { data: null };
    const due = conv?.pickup_at
      ? new Date(conv.pickup_at).getTime() + 2 * 864e5
      : new Date(p.paid_at ?? now.toISOString()).getTime() + 14 * 864e5;
    if (due > now.getTime()) continue;
    await releaseProtected(p.id, 'automatico', origin, invalidate).catch((e) => console.warn(`[giro] rilascio automatico: ${(e as Error).message}`));
    n += 1;
  }
  return n;
}
