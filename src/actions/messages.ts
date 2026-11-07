import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { getListing, refreshListings } from '../core/store.ts';
import { findConversation } from '../lib/messages.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { zurichToIso } from '../core/pickup.ts';
import { assistAfterAcceptedOffer, assistAfterBuyerMessage } from '../lib/seller-assistant.ts';

function requireUser(context: ActionAPIContext) {
  const { supabase, user } = context.locals;
  if (!supabase) throw new ActionError({ code: 'BAD_REQUEST', message: 'Supabase non è configurato.' });
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Accedi per scrivere.' });
  return { supabase, user };
}

const body = z.string().trim().max(2000, 'Il messaggio supera i 2000 caratteri.').nullish();
const offer = z.coerce.number().positive("L'offerta deve essere maggiore di zero.").max(1_000_000).nullish();
/** Ritiro proposto: giorno e ora svizzeri dal modulo, luogo facoltativo. */
const pickupFields = {
  pickupDay: z.string().trim().nullish(),
  pickupTime: z.string().trim().nullish(),
  pickupPlace: z.string().trim().max(120, 'Il luogo del ritiro è troppo lungo.').nullish(),
};
type PickupInput = { pickupDay?: string | null; pickupTime?: string | null; pickupPlace?: string | null };

/** Dal modulo all'istante del ritiro, oppure un errore chiaro. */
function pickupFrom(input: PickupInput): { at: string; place: string | null } | null {
  if (!input.pickupDay && !input.pickupTime) return null;
  if (!input.pickupDay || !input.pickupTime) throw new ActionError({ code: 'BAD_REQUEST', message: 'Per proporre il ritiro indica giorno e ora.' });
  const at = zurichToIso(input.pickupDay, input.pickupTime);
  if (!at) throw new ActionError({ code: 'BAD_REQUEST', message: 'Giorno o ora del ritiro non validi.' });
  const ms = new Date(at).getTime() - Date.now();
  if (ms < 30 * 60_000) throw new ActionError({ code: 'BAD_REQUEST', message: 'Il ritiro deve essere almeno tra mezz\'ora.' });
  if (ms > 60 * 864e5) throw new ActionError({ code: 'BAD_REQUEST', message: 'Il ritiro può essere al massimo tra due mesi.' });
  return { at, place: input.pickupPlace || null };
}

/**
 * Inserisce testo, offerta e/o proposta di ritiro (dentro l'offerta, se c'è).
 * Le regole del database controllano chi può scrivere e quando. Restituisce l'offerta inviata, per l'assistente venditore.
 */
async function post(
  supabase: NonNullable<App.Locals['supabase']>,
  conversationId: string,
  senderId: string,
  text: string | null | undefined,
  amount: number | null | undefined,
  pickup: { at: string; place: string | null } | null = null,
) {
  if (!text && !amount && !pickup) throw new ActionError({ code: 'BAD_REQUEST', message: 'Scrivi un messaggio, fai un\'offerta o proponi il ritiro.' });
  if (text) {
    const { error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: senderId, body: text });
    if (error) throw new ActionError({ code: 'FORBIDDEN', message: `Messaggio non inviato: ${error.message}` });
  }
  const when = pickup ? { pickup_at: pickup.at, pickup_place: pickup.place } : {};
  if (amount) {
    const offerChf = Math.round(amount * 100) / 100;
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, kind: 'offerta', offer_chf: offerChf, offer_status: 'in_attesa', ...when })
      .select('id')
      .single();
    if (error) throw new ActionError({ code: 'FORBIDDEN', message: 'Offerta non inviata: l\'annuncio potrebbe non essere più in vendita.' });
    return { offerId: data.id as number, offerChf };
  } else if (pickup) {
    const { error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, kind: 'ritiro', offer_status: 'in_attesa', ...when });
    if (error) throw new ActionError({ code: 'FORBIDDEN', message: 'Proposta di ritiro non inviata: l\'annuncio potrebbe non essere più in vendita.' });
  }
  return { offerId: null, offerChf: null };
}

export const messages = {
  /** Primo contatto da una scheda annuncio: apre (o riprende) la conversazione. */
  start: defineAction({
    accept: 'form',
    input: z.object({ listingId: z.string().min(1), body, offer, ...pickupFields }),
    handler: async ({ listingId, body: text, offer: amount, ...when }, context) => {
      const { supabase, user } = requireUser(context);
      const pickup = pickupFrom(when);
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
      const offer = await post(supabase, conversationId, user.id, text, amount, pickup);
      assistAfterBuyerMessage(conversationId, user.id, { text, ...offer });
      return { conversationId };
    },
  }),

  send: defineAction({
    accept: 'form',
    input: z.object({ conversationId: z.string().uuid(), body, offer, ...pickupFields }),
    handler: async ({ conversationId, body: text, offer: amount, ...when }, context) => {
      const { supabase, user } = requireUser(context);
      const offer = await post(supabase, conversationId, user.id, text, amount, pickupFrom(when));
      assistAfterBuyerMessage(conversationId, user.id, { text, ...offer });
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
        // Accordo sul prezzo: l'assistente venditore (se acceso) propone subito un orario di ritiro
        const { data: accepted } = await supabase.from('messages').select('kind, pickup_at').eq('id', messageId).maybeSingle();
        if (accepted?.kind === 'offerta' && !accepted.pickup_at) assistAfterAcceptedOffer(conversationId);
      }
      return { conversationId, decision };
    },
  }),

  /** Dopo il ritiro, chi vende dice com'è andata: "non venduto" rimette l'annuncio in vendita. */
  pickupOutcome: defineAction({
    accept: 'form',
    input: z.object({ conversationId: z.string().uuid(), outcome: z.enum(['venduto', 'non_venduto']) }),
    handler: async ({ conversationId, outcome }, context) => {
      const { supabase } = requireUser(context);
      const { error } = await supabase.rpc('set_pickup_outcome', { p_conversation_id: conversationId, p_outcome: outcome });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: error.message });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { conversationId, outcome };
    },
  }),
};
