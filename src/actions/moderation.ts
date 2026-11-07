import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { adminClient } from '../lib/admin.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { applyDecision, ModerationError, undoAction } from '../lib/moderation.ts';
import { moderateWithAgent } from '../lib/moderation-agent.ts';
import { notify, siteOrigin } from '../lib/notify.ts';
import { requireUser } from './account.ts';

/** Solo chi ha is_moderator nel profilo (lo assegna chi gestisce il database). */
export async function requireModerator(context: ActionAPIContext) {
  const { supabase, user } = requireUser(context);
  const { data } = await supabase.from('profiles').select('is_moderator').eq('id', user.id).maybeSingle();
  const admin = adminClient();
  if (!data?.is_moderator || !admin) throw new ActionError({ code: 'FORBIDDEN', message: 'Solo chi modera può decidere sulle segnalazioni.' });
  return { user, admin };
}

const TARGET = /^(annuncio|domanda|valutazione|utente|conversazione):.+$/;
const asActionError = (error: unknown) =>
  error instanceof ModerationError ? new ActionError({ code: 'BAD_REQUEST', message: error.message }) : error;

/** Decisioni delle persone che moderano; quelle dell'agente passano dagli stessi passi (lib/moderation.ts). */
export const moderation = {
  decide: defineAction({
    accept: 'form',
    input: z.object({
      target: z.string().regex(TARGET),
      decision: z.enum(['nascondi', 'respingi', 'sospendi']),
      message: z.string().trim().max(300).nullish(),
    }),
    handler: async ({ target, decision, message }, context) => {
      const { user, admin } = await requireModerator(context);
      try {
        await applyDecision({
          admin,
          target,
          decision,
          actor: 'persona',
          moderatorId: user.id,
          message: message || null,
          origin: siteOrigin(context.url.origin),
        });
      } catch (error) {
        throw asActionError(error);
      }
      await invalidateListingPages(context);
      return { target, decision };
    },
  }),

  /** Annulla una decisione, dell'agente o di una persona. */
  undo: defineAction({
    accept: 'form',
    input: z.object({ actionId: z.string().uuid() }),
    handler: async ({ actionId }, context) => {
      const { user, admin } = await requireModerator(context);
      try {
        await undoAction(admin, actionId, user.id, siteOrigin(context.url.origin));
      } catch (error) {
        throw asActionError(error);
      }
      await invalidateListingPages(context);
      return { actionId };
    },
  }),

  /** Decide una contestazione: accolta annulla la decisione, respinta la conferma con una risposta. */
  decideAppeal: defineAction({
    accept: 'form',
    input: z.object({
      appealId: z.string().uuid(),
      decision: z.enum(['accogli', 'respingi']),
      reply: z.string().trim().max(1000).nullish(),
    }),
    handler: async ({ appealId, decision, reply }, context) => {
      const { user, admin } = await requireModerator(context);
      const { data: appeal } = await admin.from('appeals').select('id, action_id, user_id, status').eq('id', appealId).maybeSingle();
      if (!appeal || appeal.status !== 'aperta') throw new ActionError({ code: 'NOT_FOUND', message: 'Contestazione non trovata o già decisa.' });
      if (decision === 'respingi' && !reply) throw new ActionError({ code: 'BAD_REQUEST', message: 'Scrivi una risposta: chi contesta deve sapere perché la decisione resta.' });
      const origin = siteOrigin(context.url.origin);
      if (decision === 'accogli') {
        try {
          // Annullare avvisa già la persona (contenuto o account di nuovo visibili)
          await undoAction(admin, appeal.action_id, user.id, origin);
        } catch (error) {
          throw asActionError(error);
        }
      } else {
        await notify(
          [
            {
              userId: appeal.user_id,
              kind: 'contestazione',
              title: 'Abbiamo riesaminato la decisione: resta valida',
              body: reply ?? '',
              url: `/contesta/${appeal.action_id}`,
            },
          ],
          origin,
        );
      }
      await admin
        .from('appeals')
        .update({ status: decision === 'accogli' ? 'accolta' : 'respinta', reply: reply || null, decided_at: new Date().toISOString(), decided_by: user.id })
        .eq('id', appealId);
      await invalidateListingPages(context);
      return { appealId, decision };
    },
  }),

  /** Rischio truffa: chi modera ha guardato l'annuncio e va bene (finché il punteggio non sale). */
  riskOk: defineAction({
    accept: 'form',
    input: z.object({ listingId: z.string().min(1) }),
    handler: async ({ listingId }, context) => {
      const { user, admin } = await requireModerator(context);
      const { data: risk } = await admin.from('listing_risk').select('score').eq('listing_id', listingId).maybeSingle();
      if (!risk) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra quelli a rischio.' });
      await admin
        .from('listing_risk')
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id, reviewed_score: risk.score })
        .eq('listing_id', listingId);
      return { listingId };
    },
  }),

  /**
   * Rischio truffa: nasconde l'annuncio. Passa da una segnalazione di chi modera, così la decisione
   * finisce nel registro, chi ha pubblicato riceve l'avviso e la può contestare, e si può annullare.
   */
  riskHide: defineAction({
    accept: 'form',
    input: z.object({ listingId: z.string().min(1), message: z.string().trim().max(300).nullish() }),
    handler: async ({ listingId, message }, context) => {
      const { user, admin } = await requireModerator(context);
      const { data: risk } = await admin.from('listing_risk').select('score, reasons').eq('listing_id', listingId).maybeSingle();
      if (!risk) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra quelli a rischio.' });
      const note = `Rischio truffa: ${(risk.reasons as string[]).join('; ')}`.slice(0, 500);
      const { error: reportError } = await admin.from('reports').insert({ reporter_id: user.id, listing_id: listingId, reason: 'truffa', note });
      // Già segnalato da chi modera: va bene, la segnalazione aperta c'è
      if (reportError && reportError.code !== '23505') throw new ActionError({ code: 'BAD_REQUEST', message: reportError.message });
      try {
        await applyDecision({
          admin,
          target: `annuncio:${listingId}`,
          decision: 'nascondi',
          actor: 'persona',
          moderatorId: user.id,
          reason: note,
          message: message || 'Sembra un tentativo di truffa.',
          origin: siteOrigin(context.url.origin),
        });
      } catch (error) {
        throw asActionError(error);
      }
      await admin
        .from('listing_risk')
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id, reviewed_score: risk.score })
        .eq('listing_id', listingId);
      await invalidateListingPages(context);
      return { listingId };
    },
  }),

  /** Chiede all'agente di esaminare un contenuto (per esempio dopo aver aggiunto la chiave di Claude). */
  askAgent: defineAction({
    accept: 'form',
    input: z.object({ target: z.string().regex(TARGET) }),
    handler: async ({ target }, context) => {
      await requireModerator(context);
      const outcome = await moderateWithAgent(target, siteOrigin(context.url.origin));
      if ('skipped' in outcome) throw new ActionError({ code: 'BAD_REQUEST', message: outcome.skipped });
      await invalidateListingPages(context);
      return { target, action: outcome.action };
    },
  }),
};
