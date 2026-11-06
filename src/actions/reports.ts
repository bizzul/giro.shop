import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { getListing, refreshListings } from '../core/store.ts';
import { adminClient } from '../lib/admin.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { notify, siteOrigin } from '../lib/notify.ts';
import { requireUser } from './account.ts';

export const REPORT_REASONS = {
  truffa: 'Sembra una truffa',
  vietato: 'Oggetto vietato o pericoloso',
  offensivo: 'Contenuto offensivo',
  falso: 'Descrizione falsa o fuorviante',
  spam: 'Spam o pubblicità',
  altro: 'Altro',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
const REASONS = Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]];

const empty = (v: unknown) => (v === '' ? null : v);

/** Segnalazioni: le regole del database decidono cosa si può segnalare; chi modera riceve un avviso. */
export const reports = {
  create: defineAction({
    accept: 'form',
    input: z.object({
      listingId: z.string().min(1),
      questionId: z.preprocess(empty, z.string().uuid().nullish()),
      ratingId: z.preprocess(empty, z.string().uuid().nullish()),
      reason: z.enum(REASONS, { message: 'Scegli un motivo.' }),
      note: z.string().trim().max(500, 'Al massimo 500 caratteri.').nullish(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireUser(context);
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        listing_id: input.listingId,
        question_id: input.questionId ?? null,
        rating_id: input.ratingId ?? null,
        reason: input.reason,
        note: input.note || null,
      });
      if (error) {
        if (error.code === '23505') throw new ActionError({ code: 'CONFLICT', message: 'Hai già segnalato questo contenuto: lo stiamo controllando.' });
        const own = !input.questionId && !input.ratingId && getListing(input.listingId)?.sellerId === user.id;
        throw new ActionError({ code: 'BAD_REQUEST', message: own ? 'Non puoi segnalare un tuo annuncio.' : `Segnalazione non inviata: ${error.message}` });
      }

      // Avviso a chi modera; se la segnalazione ha nascosto il contenuto, la scheda va aggiornata
      const admin = adminClient();
      const listing = getListing(input.listingId);
      const what = input.questionId ? 'una domanda' : input.ratingId ? 'una valutazione' : "l'annuncio";
      if (admin) {
        const { data: mods } = await admin.from('profiles').select('id').eq('is_moderator', true);
        await notify(
          (mods ?? [])
            .filter((m) => m.id !== user.id)
            .map((m) => ({
              userId: m.id as string,
              kind: 'segnalazione' as const,
              title: `Segnalazione: ${what} su «${listing?.title ?? 'un annuncio'}»`,
              body: `${REPORT_REASONS[input.reason]}${input.note ? ` · «${input.note}»` : ''}`,
              url: '/moderazione',
              listingId: input.listingId,
            })),
          siteOrigin(context.url.origin),
        );
      }
      await refreshListings(true);
      await invalidateListingPages(context);
      return { listingId: input.listingId };
    },
  }),
};
