import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { parseQuery } from '../core/query.ts';
import { requireUser } from './account.ts';

const MAX_SEARCHES = 20;

/** Ricerche salvate con avviso, annunci salvati (cuore) e avvisi letti. */
export const alerts = {
  saveSearch: defineAction({
    accept: 'form',
    input: z.object({ q: z.string().trim().min(2, 'Scrivi cosa cerchi.').max(200) }),
    handler: async ({ q }, context) => {
      const { supabase, user } = requireUser(context);
      const { data: existing } = await supabase.from('alerts').select('id, query').eq('user_id', user.id);
      const same = (existing ?? []).find((a) => a.query.trim().toLowerCase() === q.toLowerCase());
      if (same) return { id: same.id as string, query: q, already: true };
      if ((existing?.length ?? 0) >= MAX_SEARCHES) {
        throw new ActionError({ code: 'BAD_REQUEST', message: `Puoi salvare al massimo ${MAX_SEARCHES} ricerche: togline una.` });
      }
      const { filters } = parseQuery(q);
      const { data, error } = await supabase.from('alerts').insert({ user_id: user.id, query: q, filters }).select('id').single();
      if (error || !data) throw new ActionError({ code: 'BAD_REQUEST', message: `Ricerca non salvata: ${error?.message}` });
      return { id: data.id as string, query: q, already: false };
    },
  }),

  deleteSearch: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => {
      const { supabase, user } = requireUser(context);
      const { error } = await supabase.from('alerts').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Ricerca non tolta: ${error.message}` });
      return { id };
    },
  }),

  /** Salva o toglie un annuncio dai salvati. */
  toggleFavorite: defineAction({
    accept: 'form',
    input: z.object({ listingId: z.string().min(1) }),
    handler: async ({ listingId }, context) => {
      const { supabase, user } = requireUser(context);
      const { data: existing } = await supabase.from('favorites').select('listing_id').eq('user_id', user.id).eq('listing_id', listingId).maybeSingle();
      const { error } = existing
        ? await supabase.from('favorites').delete().eq('user_id', user.id).eq('listing_id', listingId)
        : await supabase.from('favorites').insert({ user_id: user.id, listing_id: listingId });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non riesco a salvare l'annuncio: ${error.message}` });
      return { listingId, saved: !existing };
    },
  }),

  markAllRead: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const { supabase, user } = requireUser(context);
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
      return { ok: true };
    },
  }),
};
