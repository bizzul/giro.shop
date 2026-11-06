import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { adminClient } from '../lib/admin.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { applyDecision, ModerationError, undoAction } from '../lib/moderation.ts';
import { moderateWithAgent } from '../lib/moderation-agent.ts';
import { siteOrigin } from '../lib/notify.ts';
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
