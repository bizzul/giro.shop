import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { getListing, refreshListings } from '../core/store.ts';
import { adminClient } from '../lib/admin.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { claudeKey } from '../lib/claude.ts';
import { moderateInBackground } from '../lib/moderation-agent.ts';
import { notify, siteOrigin } from '../lib/notify.ts';
import { requireUser } from './account.ts';

export { REPORT_REASONS, type ReportReason } from '../core/rules.ts';
import { REPORT_REASONS, type ReportReason } from '../core/rules.ts';
const REASONS = Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]];

const empty = (v: unknown) => (v === '' ? null : v);

/**
 * Segnalazioni di annunci, domande, valutazioni, utenti e conversazioni private.
 * Le regole del database decidono cosa si può segnalare. Poi l'agente di moderazione esamina
 * il contenuto in sottofondo; senza agente (manca la chiave di Claude) avvisa chi modera.
 */
export const reports = {
  create: defineAction({
    accept: 'form',
    input: z.object({
      listingId: z.preprocess(empty, z.string().min(1).nullish()),
      questionId: z.preprocess(empty, z.string().uuid().nullish()),
      ratingId: z.preprocess(empty, z.string().uuid().nullish()),
      reportedUserId: z.preprocess(empty, z.string().uuid().nullish()),
      conversationId: z.preprocess(empty, z.string().uuid().nullish()),
      reason: z.enum(REASONS, { message: 'Scegli un motivo.' }),
      note: z.string().trim().max(500, 'Al massimo 500 caratteri.').nullish(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireUser(context);

      // Conversazione: si segnala l'altra persona, l'annuncio è quello della conversazione
      let listingId = input.listingId ?? null;
      let reportedUserId = input.reportedUserId ?? null;
      if (input.conversationId) {
        const { data: c } = await supabase.from('conversations').select('listing_id, buyer_id, seller_id').eq('id', input.conversationId).maybeSingle();
        if (!c) throw new ActionError({ code: 'NOT_FOUND', message: 'Conversazione non trovata tra le tue.' });
        listingId = c.listing_id;
        reportedUserId = c.buyer_id === user.id ? c.seller_id : c.buyer_id;
      }
      if (reportedUserId === user.id) throw new ActionError({ code: 'BAD_REQUEST', message: 'Non puoi segnalare te stesso.' });

      const { data: row, error } = await supabase
        .from('reports')
        .insert({
          reporter_id: user.id,
          listing_id: listingId,
          question_id: input.questionId ?? null,
          rating_id: input.ratingId ?? null,
          conversation_id: input.conversationId ?? null,
          reported_user_id: input.conversationId || !listingId ? reportedUserId : null,
          reason: input.reason,
          note: input.note || null,
        })
        .select('target')
        .single();
      if (error || !row) {
        if (error?.code === '23505') throw new ActionError({ code: 'CONFLICT', message: 'Hai già segnalato questo contenuto: lo stiamo controllando.' });
        const own = listingId && !input.questionId && !input.ratingId && !input.conversationId && getListing(listingId)?.sellerId === user.id;
        throw new ActionError({ code: 'BAD_REQUEST', message: own ? 'Non puoi segnalare un tuo annuncio.' : `Segnalazione non inviata: ${error?.message}` });
      }
      const target = row.target as string;
      const origin = siteOrigin(context.url.origin);

      if (claudeKey()) {
        // L'agente esamina subito, senza far aspettare chi ha segnalato
        moderateInBackground(target, origin, () => invalidateListingPages(context));
      } else {
        const admin = adminClient();
        const listing = listingId ? getListing(listingId) : undefined;
        const what = input.conversationId
          ? 'una conversazione'
          : input.questionId
            ? 'una domanda'
            : input.ratingId
              ? 'una valutazione'
              : listingId
                ? "l'annuncio"
                : 'un utente';
        if (admin) {
          const { data: mods } = await admin.from('profiles').select('id').eq('is_moderator', true);
          await notify(
            (mods ?? [])
              .filter((m) => m.id !== user.id)
              .map((m) => ({
                userId: m.id as string,
                kind: 'segnalazione' as const,
                title: `Segnalazione: ${what}${listing ? ` su «${listing.title}»` : ''}`,
                body: `${REPORT_REASONS[input.reason]}${input.note ? ` · «${input.note}»` : ''}`,
                url: '/moderazione',
                listingId: listingId ?? undefined,
              })),
            origin,
          );
        }
      }
      // Se la segnalazione ha nascosto il contenuto (troppe segnalazioni), la scheda va aggiornata
      await refreshListings(true);
      await invalidateListingPages(context);
      return { target, listingId };
    },
  }),
};
