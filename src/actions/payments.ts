import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { invalidateListingPages } from '../lib/cache.ts';
import { siteOrigin } from '../lib/notify.ts';
import { PaymentError } from '../lib/payments.ts';
import { cancelPurchase, confirmPurchase } from '../lib/purchases.ts';
import { disputeProtected, refundProtected, releaseProtected } from '../lib/protected.ts';
import { requireUser } from './account.ts';

const asActionError = (error: unknown) => (error instanceof PaymentError ? new ActionError({ code: 'BAD_REQUEST', message: error.message }) : error);

async function run<T>(context: ActionAPIContext, task: (userId: string, origin: string, invalidate: () => Promise<void>) => Promise<T>): Promise<T> {
  const { user } = requireUser(context);
  try {
    return await task(user.id, siteOrigin(context.url.origin), () => invalidateListingPages(context));
  } catch (error) {
    throw asActionError(error);
  }
}

/** Pagina di pagamento (di prova) e pagamento protetto. */
export const payments = {
  confirm: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => ({ url: await run(context, (userId, origin, invalidate) => confirmPurchase(id, userId, origin, invalidate)) }),
  }),

  cancel: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => ({ url: await run(context, (userId) => cancelPurchase(id, userId)) }),
  }),

  /** Chi compra: "ho ricevuto l'oggetto, va tutto bene". */
  release: defineAction({
    accept: 'form',
    input: z.object({ paymentId: z.string().uuid() }),
    handler: async ({ paymentId }, context) => {
      await run(context, (userId, origin, invalidate) => releaseProtected(paymentId, { userId }, origin, invalidate));
      return { paymentId };
    },
  }),

  /** Chi compra: "c'è un problema". */
  dispute: defineAction({
    accept: 'form',
    input: z.object({ paymentId: z.string().uuid(), reason: z.string().trim().min(5, 'Scrivi cosa non va.').max(500) }),
    handler: async ({ paymentId, reason }, context) => {
      await run(context, (userId, origin) => disputeProtected(paymentId, userId, reason, origin));
      return { paymentId };
    },
  }),

  /** Chi vende: non può consegnare, rimborsa. */
  refund: defineAction({
    accept: 'form',
    input: z.object({ paymentId: z.string().uuid() }),
    handler: async ({ paymentId }, context) => {
      await run(context, (userId, origin, invalidate) => refundProtected(paymentId, { userId }, origin, invalidate));
      return { paymentId };
    },
  }),
};
