import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { getListing, refreshListings } from '../core/store.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { notify, siteOrigin } from '../lib/notify.ts';
import { requireUser } from './account.ts';

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Domande pubbliche sugli annunci: chi compra chiede, chi vende risponde una volta per tutti. */
export const questions = {
  ask: defineAction({
    accept: 'form',
    input: z.object({
      listingId: z.string().min(1),
      body: z.string().trim().min(3, 'Scrivi la domanda.').max(500, 'Al massimo 500 caratteri.'),
    }),
    handler: async ({ listingId, body }, context) => {
      const { supabase, user } = requireUser(context);
      const listing = getListing(listingId);
      if (!listing) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato.' });
      if (listing.sellerId === user.id) throw new ActionError({ code: 'BAD_REQUEST', message: 'È un tuo annuncio: rispondi alle domande qui sotto.' });
      const { error } = await supabase.from('questions').insert({ listing_id: listingId, asker_id: user.id, body });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Domanda non inviata: ${error.message}` });
      if (listing.sellerId) {
        await notify(
          [{ userId: listing.sellerId, kind: 'domanda', title: `Nuova domanda su «${listing.title}»`, body: short(body), url: `/annuncio/${listingId}#domande`, listingId }],
          siteOrigin(context.url.origin),
        );
      }
      await refreshListings(true);
      await invalidateListingPages(context);
      return { listingId };
    },
  }),

  answer: defineAction({
    accept: 'form',
    input: z.object({
      id: z.string().uuid(),
      answer: z.string().trim().min(1, 'Scrivi la risposta.').max(1000, 'Al massimo 1000 caratteri.'),
    }),
    handler: async ({ id, answer }, context) => {
      const { supabase } = requireUser(context);
      const { data, error } = await supabase
        .from('questions')
        .update({ answer, answered_at: new Date().toISOString() })
        .eq('id', id)
        .select('listing_id, asker_id, body')
        .maybeSingle();
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Risposta non salvata: ${error.message}` });
      if (!data) throw new ActionError({ code: 'NOT_FOUND', message: 'Domanda non trovata tra quelle sui tuoi annunci.' });
      const listing = getListing(data.listing_id);
      await notify(
        [
          {
            userId: data.asker_id,
            kind: 'risposta',
            title: `Risposta alla tua domanda su «${listing?.title ?? 'un annuncio'}»`,
            body: short(answer),
            url: `/annuncio/${data.listing_id}#domande`,
            listingId: data.listing_id,
          },
        ],
        siteOrigin(context.url.origin),
      );
      await refreshListings(true);
      await invalidateListingPages(context);
      return { listingId: data.listing_id as string };
    },
  }),
};
