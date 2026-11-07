import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { siteOrigin } from '../lib/notify.ts';
import { allow } from '../lib/claude.ts';
import { applyAsPartner, contactPartner, PartnerError, SERVICE_KEYS, type Service } from '../lib/partners.ts';

const DISTRICTS = ['Bellinzona', 'Blenio', 'Leventina', 'Locarno', 'Lugano', 'Mendrisio', 'Riviera', 'Vallemaggia'] as const;
const asActionError = (error: unknown) => (error instanceof PartnerError ? new ActionError({ code: 'BAD_REQUEST', message: error.message }) : error);
const optional = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullish());

/** Partner locali: richiesta di preventivo (anche senza account) e richiesta per diventare partner. */
export const partners = {
  contact: defineAction({
    accept: 'form',
    input: z.object({
      partnerId: z.string().uuid(),
      name: z.string().trim().min(2, 'Scrivi il tuo nome.').max(80),
      contact: z.string().trim().min(5, 'Scrivi un telefono o un indirizzo email.').max(120),
      message: z.string().trim().min(10, 'Racconta in due righe cosa serve.').max(1000),
      listingId: optional(80),
      consent: z.literal('on', { message: 'Serve il tuo consenso per mandare i dati al partner.' }),
    }),
    handler: async (input, context) => {
      if (!allow(`partner:${context.locals.user?.id ?? context.clientAddress}`, 10, 60 * 60_000)) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Troppe richieste in poco tempo: riprova più tardi.' });
      }
      try {
        await contactPartner({ ...input, userId: context.locals.user?.id ?? null, origin: siteOrigin(context.url.origin) });
      } catch (error) {
        throw asActionError(error);
      }
      return { partnerId: input.partnerId };
    },
  }),

  apply: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().trim().min(2, 'Scrivi il nome della ditta.').max(80),
      service: z.enum(SERVICE_KEYS as [Service, ...Service[]]),
      about: optional(400),
      district: z.array(z.enum(DISTRICTS)).default([]),
      website: z.preprocess((v) => (v === '' ? null : v), z.string().trim().url('Scrivi il sito completo, con https://').max(200).nullish()),
      phone: optional(30),
      email: z.string().trim().email('Scrivi un indirizzo email valido.').max(120),
    }),
    handler: async ({ district, ...input }, context) => {
      if (!allow(`partner-richiesta:${context.clientAddress}`, 5, 24 * 60 * 60_000)) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Troppe richieste: riprova domani.' });
      }
      try {
        await applyAsPartner({ ...input, districts: district });
      } catch (error) {
        throw asActionError(error);
      }
      return { name: input.name };
    },
  }),
};
