import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { getListing, refreshListings } from '../core/store.ts';
import { findConversation } from '../lib/messages.ts';
import { invalidateListingPages } from '../lib/cache.ts';

function requireUser(context: ActionAPIContext) {
  const { supabase, user } = context.locals;
  if (!supabase) throw new ActionError({ code: 'BAD_REQUEST', message: 'Supabase non è configurato.' });
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Accedi per scrivere.' });
  return { supabase, user };
}

const body = z.string().trim().max(2000, 'Il messaggio supera i 2000 caratteri.').nullish();
const offer = z.coerce.number().positive("L'offerta deve essere maggiore di zero.").max(1_000_000).nullish();

/** Inserisce testo e/o offerta. Le regole del database controllano chi può scrivere e quando. */
async function post(
  supabase: NonNullable<App.Locals['supabase']>,
  conversationId: string,
  senderId: string,
  text: string | null | undefined,
  amount: number | null | undefined,
) {
  if (!text && !amount) throw new ActionError({ code: 'BAD_REQUEST', message: 'Scrivi un messaggio o indica un\'offerta.' });
  if (text) {
    const { error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: senderId, body: text });
    if (error) throw new ActionError({ code: 'FORBIDDEN', message: `Messaggio non inviato: ${error.message}` });
  }
  if (amount) {
    const { error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, kind: 'offerta', offer_chf: Math.round(amount * 100) / 100, offer_status: 'in_attesa' });
    if (error) throw new ActionError({ code: 'FORBIDDEN', message: 'Offerta non inviata: l\'annuncio potrebbe non essere più in vendita.' });
  }
}

export const messages = {
  /** Primo contatto da una scheda annuncio: apre (o riprende) la conversazione. */
  start: defineAction({
    accept: 'form',
    input: z.object({ listingId: z.string().min(1), body, offer }),
    handler: async ({ listingId, body: text, offer: amount }, context) => {
      const { supabase, user } = requireUser(context);
      const listing = getListing(listingId);
      if (!listing || listing.status !== 'pubblicato' || !listing.sellerId) {
        throw new ActionError({ code: 'NOT_FOUND', message: 'Questo annuncio non è più in vendita.' });
      }
      if (listing.sellerId === user.id) throw new ActionError({ code: 'BAD_REQUEST', message: 'È un tuo annuncio.' });

      let conversationId = await findConversation(supabase, user.id, listingId);
      if (!conversationId) {
        const { data, error } = await supabase
          .from('conversations')
          .insert({ listing_id: listingId, buyer_id: user.id, seller_id: listing.sellerId })
          .select('id')
          .single();
        if (error || !data) throw new ActionError({ code: 'FORBIDDEN', message: `Non riesco ad aprire la conversazione: ${error?.message}` });
        conversationId = data.id as string;
      }
      await post(supabase, conversationId, user.id, text, amount);
      return { conversationId };
    },
  }),

  send: defineAction({
    accept: 'form',
    input: z.object({ conversationId: z.string().uuid(), body, offer }),
    handler: async ({ conversationId, body: text, offer: amount }, context) => {
      const { supabase, user } = requireUser(context);
      await post(supabase, conversationId, user.id, text, amount);
      return { conversationId };
    },
  }),

  /** Accetta, rifiuta o ritira un'offerta (controlli nella funzione respond_to_offer del database). */
  respond: defineAction({
    accept: 'form',
    input: z.object({
      conversationId: z.string().uuid(),
      messageId: z.coerce.number().int().positive(),
      decision: z.enum(['accettata', 'rifiutata', 'ritirata']),
    }),
    handler: async ({ conversationId, messageId, decision }, context) => {
      const { supabase } = requireUser(context);
      const { error } = await supabase.rpc('respond_to_offer', { p_message_id: messageId, p_decision: decision });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: error.message });
      if (decision === 'accettata') {
        await refreshListings(true);
        await invalidateListingPages(context);
      }
      return { conversationId, decision };
    },
  }),
};
