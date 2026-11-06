import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { refreshListings } from '../core/store.ts';
import { adminClient } from '../lib/admin.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { notify, siteOrigin, type Notice } from '../lib/notify.ts';
import { requireUser } from './account.ts';

/** Solo chi ha is_moderator nel profilo (lo assegna chi gestisce il database). */
export async function requireModerator(context: ActionAPIContext) {
  const { supabase, user } = requireUser(context);
  const { data } = await supabase.from('profiles').select('is_moderator').eq('id', user.id).maybeSingle();
  const admin = adminClient();
  if (!data?.is_moderator || !admin) throw new ActionError({ code: 'FORBIDDEN', message: 'Solo chi modera può decidere sulle segnalazioni.' });
  return { user, admin };
}

/** "annuncio:l-001", "domanda:<uuid>", "valutazione:<uuid>" */
const TARGET = /^(annuncio|domanda|valutazione):(.+)$/;

export const moderation = {
  decide: defineAction({
    accept: 'form',
    input: z.object({
      target: z.string().regex(TARGET),
      decision: z.enum(['nascondi', 'respingi']),
      message: z.string().trim().max(300).nullish(),
    }),
    handler: async ({ target, decision, message }, context) => {
      const { admin } = await requireModerator(context);
      const [, kind, id] = target.match(TARGET)!;
      const { data: open } = await admin.from('reports').select('reporter_id, listing_id').eq('target', target).eq('status', 'aperta');
      if (!open?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Nessuna segnalazione aperta su questo contenuto.' });
      const listingId = open[0].listing_id as string;
      const { data: listing } = await admin.from('listings').select('id, title, seller_id, hidden_at, hidden_reason').eq('id', listingId).maybeSingle();
      const table = kind === 'annuncio' ? 'listings' : kind === 'domanda' ? 'questions' : 'ratings';
      const now = new Date().toISOString();
      const notices: Notice[] = [];
      const reporters = [...new Set(open.map((r) => r.reporter_id as string))];
      const what = kind === 'annuncio' ? `l'annuncio «${listing?.title}»` : kind === 'domanda' ? `la domanda su «${listing?.title}»` : `la valutazione su «${listing?.title}»`;

      if (decision === 'nascondi') {
        const patch = kind === 'annuncio' ? { hidden_at: now, hidden_reason: message || 'moderazione' } : { hidden_at: now };
        const { error } = await admin.from(table).update(patch).eq('id', id);
        if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non nascosto: ${error.message}` });
        notices.push(
          ...reporters.map((userId) => ({
            userId,
            kind: 'segnalazione' as const,
            title: `Abbiamo tolto ${what}`,
            body: 'Grazie della segnalazione: aiuta tutti a comprare e vendere tranquilli.',
            url: '/avvisi',
            listingId,
          })),
        );
        if (kind === 'annuncio' && listing?.seller_id) {
          notices.push({
            userId: listing.seller_id,
            kind: 'segnalazione',
            title: `«${listing.title}» è stato nascosto`,
            body: message || 'Non rispetta le regole di giro.shop. Se pensi sia un errore, scrivici rispondendo a questa email.',
            url: `/miei-annunci#a-${listing.id}`,
            listingId,
          });
        }
      } else {
        // Respinta: se era nascosto solo per le segnalazioni, torna visibile
        if (kind === 'annuncio' && listing?.hidden_at && listing.hidden_reason === 'segnalazioni') {
          await admin.from('listings').update({ hidden_at: null, hidden_reason: null }).eq('id', id);
          if (listing.seller_id) {
            notices.push({
              userId: listing.seller_id,
              kind: 'segnalazione',
              title: `«${listing.title}» è di nuovo visibile`,
              body: "L'abbiamo controllato: è tutto a posto.",
              url: `/annuncio/${listing.id}`,
              listingId,
            });
          }
        } else if (kind !== 'annuncio') {
          await admin.from(table).update({ hidden_at: null }).eq('id', id);
        }
      }

      await admin.from('reports').update({ status: decision === 'nascondi' ? 'accolta' : 'respinta', handled_at: now }).eq('target', target).eq('status', 'aperta');
      await notify(notices, siteOrigin(context.url.origin));
      await refreshListings(true);
      await invalidateListingPages(context);
      return { target, decision };
    },
  }),
};
