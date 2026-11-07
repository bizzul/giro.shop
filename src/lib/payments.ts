import { adminClient } from './admin.ts';

/**
 * Pagamenti di giro.shop: Pro, vetrina mirata, annunci a pagamento, pagamento protetto.
 *
 * Per ora c'è solo il fornitore "prova": la pagina /pagamento/<id> mostra il riepilogo e un bottone
 * che segna il pagamento come fatto, senza addebiti. Un fornitore vero (Stripe, Payrexx) si aggancia qui:
 * `createPayment` crea anche la sessione di pagamento e restituisce il suo indirizzo, e la conferma
 * arriva dal fornitore (webhook) invece che dal bottone; tutto il resto (cosa si attiva dopo) resta uguale.
 * Gli importi li decide sempre il server, mai il modulo.
 */

export type PaymentKind = 'pro' | 'vetrina' | 'annuncio' | 'protetto';
export type PaymentStatus = 'in_attesa' | 'pagato' | 'annullato' | 'trattenuto' | 'rilasciato' | 'rimborsato' | 'contestato';

export const PAYMENT_PROVIDER = 'prova';

export interface Payment {
  id: string;
  user_id: string;
  kind: PaymentKind;
  amount_chf: number;
  fee_chf: number;
  description: string;
  status: PaymentStatus;
  listing_id: string | null;
  conversation_id: string | null;
  payee_id: string | null;
  metadata: Record<string, unknown> & { returnUrl?: string };
  created_at: string;
  paid_at: string | null;
}

export class PaymentError extends Error {}

export interface NewPayment {
  userId: string;
  kind: PaymentKind;
  amountChf: number;
  feeChf?: number;
  description: string;
  listingId?: string | null;
  conversationId?: string | null;
  payeeId?: string | null;
  metadata?: Record<string, unknown>;
  /** Dove torna la persona dopo aver pagato (o annullato). */
  returnUrl: string;
}

/** Crea il pagamento in attesa e restituisce l'indirizzo della pagina dove si paga. */
export async function createPayment(input: NewPayment): Promise<{ id: string; url: string }> {
  const admin = adminClient();
  if (!admin) throw new PaymentError('Pagamenti non disponibili: manca la configurazione del server.');
  const { data, error } = await admin
    .from('payments')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      amount_chf: input.amountChf,
      fee_chf: input.feeChf ?? input.amountChf,
      description: input.description.slice(0, 200),
      listing_id: input.listingId ?? null,
      conversation_id: input.conversationId ?? null,
      payee_id: input.payeeId ?? null,
      provider: PAYMENT_PROVIDER,
      metadata: { ...input.metadata, returnUrl: input.returnUrl },
    })
    .select('id')
    .single();
  if (error || !data) throw new PaymentError(`Pagamento non creato: ${error?.message}`);
  return { id: data.id as string, url: `/pagamento/${data.id}` };
}

export async function getPayment(id: string): Promise<Payment | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data } = await admin.from('payments').select('*').eq('id', id).maybeSingle();
  return data ? ({ ...data, amount_chf: Number(data.amount_chf), fee_chf: Number(data.fee_chf) } as Payment) : null;
}

/** Cambia stato solo se è ancora quello atteso: due clic o due richieste non pagano due volte. */
export async function moveStatus(id: string, from: PaymentStatus[], to: PaymentStatus, extra: Record<string, unknown> = {}): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { data } = await admin
    .from('payments')
    .update({ status: to, updated_at: new Date().toISOString(), ...extra })
    .eq('id', id)
    .in('status', from)
    .select('id');
  return Boolean(data?.length);
}

/** Un ritorno interno sicuro (niente altri siti). */
export const safeReturn = (url: unknown, fallback = '/miei-annunci') =>
  typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : fallback;
