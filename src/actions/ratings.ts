import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { invalidateListingPages } from '../lib/cache.ts';
import { notify, siteOrigin } from '../lib/notify.ts';
import { requireUser } from './account.ts';

export const RATING_TAGS = ['puntuale', 'come descritto', 'gentile', 'risponde veloce', 'imballato bene', 'pagamento rapido'] as const;

/** Valutazione dopo una vendita conclusa: le regole del database controllano chi può valutare chi. */
export const ratings = {
  rate: defineAction({
    accept: 'form',
    input: z.object({
      listingId: z.string().min(1),
      stars: z.coerce.number().int().min(1, 'Scegli da 1 a 5 stelle.').max(5),
      tags: z.array(z.enum(RATING_TAGS)).optional(),
      comment: z.string().trim().max(500, 'Al massimo 500 caratteri.').nullish(),
    }),
    handler: async ({ listingId, stars, tags, comment }, context) => {
      const { supabase, user } = requireUser(context);
      const { data: listing } = await supabase.from('listings').select('id, title, seller_id, buyer_id, status').eq('id', listingId).maybeSingle();
      if (!listing || listing.status !== 'venduto' || !listing.buyer_id) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Si può valutare solo una vendita conclusa.' });
      }
      const rated = user.id === listing.seller_id ? listing.buyer_id : user.id === listing.buyer_id ? listing.seller_id : null;
      if (!rated) throw new ActionError({ code: 'FORBIDDEN', message: 'Questa vendita non è tua.' });
      const { error } = await supabase
        .from('ratings')
        .insert({ listing_id: listingId, rater_id: user.id, rated_id: rated, stars, tags: tags ?? [], comment: comment || null });
      if (error) {
        const twice = error.code === '23505';
        throw new ActionError({ code: twice ? 'CONFLICT' : 'BAD_REQUEST', message: twice ? 'Hai già lasciato una valutazione per questa vendita.' : `Valutazione non salvata: ${error.message}` });
      }
      const { data: me } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      await notify(
        [
          {
            userId: rated,
            kind: 'valutazione',
            title: `${me?.display_name ?? 'Qualcuno'} ti ha dato ${stars} ${stars === 1 ? 'stella' : 'stelle'}`,
            body: comment ? `«${comment}» · ${listing.title}` : listing.title,
            url: `/annuncio/${listingId}#valutazioni`,
            listingId,
          },
        ],
        siteOrigin(context.url.origin),
      );
      await invalidateListingPages(context);
      return { listingId, rated };
    },
  }),
};
