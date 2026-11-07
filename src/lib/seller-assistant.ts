import type { SupabaseClient } from '@supabase/supabase-js';
import { getComune } from '../core/comuni.ts';
import { formatChf } from '../core/format.ts';
import { nextSlots, formatPickup } from '../core/pickup.ts';
import { getListing } from '../core/store.ts';
import { intentsOf, listingFacts, ruleReply, slotText, type AssistantReply } from '../core/assistant.ts';
import { answerBuyer, ClaudeError } from '../core/claude.ts';
import { adminClient } from './admin.ts';
import { claudeKey } from './claude.ts';

/**
 * Assistente venditore, lato server. Dopo un messaggio di chi compra, se chi vende l'ha acceso:
 * - un'offerta sotto il minimo scelto da chi vende viene rifiutata con gentilezza (senza dire il minimo);
 * - alle domande ripetitive risponde con i dati dell'annuncio (con Claude se c'è la chiave, altrimenti con regole);
 * - a "quando posso passare?" propone il primo orario libero, da accettare con un tocco.
 * I messaggi partono a nome di chi vende, segnati come risposta automatica. Accettare resta una sua decisione.
 */

/** Se chi vende ha scritto da poco, la conversazione è sua: l'assistente tace. */
const SELLER_ACTIVE_MS = 15 * 60_000;
/** Al massimo tante risposte automatiche al giorno per conversazione. */
const DAILY_REPLIES = 6;

interface Sent {
  text?: string | null;
  offerId?: number | null;
  offerChf?: number | null;
}

interface Context {
  admin: SupabaseClient;
  conversationId: string;
  sellerId: string;
  sellerName: string;
  listingId: string;
  availability: string[];
}

const later = (task: Promise<unknown>) => void task.catch((e) => console.warn(`[giro] assistente venditore: ${(e as Error).message}`));

/** Dopo un messaggio di chi compra. Non fa aspettare chi scrive. */
export function assistAfterBuyerMessage(conversationId: string, buyerId: string, sent: Sent): void {
  later(run(conversationId, buyerId, sent));
}

/** Dopo che chi vende ha accettato un'offerta: propone subito il primo orario libero per il ritiro. */
export function assistAfterAcceptedOffer(conversationId: string): void {
  later(proposePickupAfterDeal(conversationId));
}

async function contextFor(conversationId: string): Promise<(Context & { buyerId: string }) | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data: conv } = await admin
    .from('conversations')
    .select('id, listing_id, buyer_id, seller_id, seller:profiles!conversations_seller_id_fkey(display_name)')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return null;
  const { data: settings } = await admin.from('seller_settings').select('assistant_on, availability').eq('user_id', conv.seller_id).maybeSingle();
  if (!settings?.assistant_on) return null;
  return {
    admin,
    conversationId,
    buyerId: conv.buyer_id,
    sellerId: conv.seller_id,
    sellerName: (conv.seller as unknown as { display_name: string } | null)?.display_name ?? 'chi vende',
    listingId: conv.listing_id,
    availability: settings.availability ?? [],
  };
}

async function say(ctx: Context, body: string): Promise<void> {
  const { error } = await ctx.admin
    .from('messages')
    .insert({ conversation_id: ctx.conversationId, sender_id: ctx.sellerId, body: body.slice(0, 2000), by_assistant: true });
  if (error) throw new Error(error.message);
}

/** Si può proporre un ritiro solo se non ce n'è già uno in attesa o fissato. */
async function canProposePickup(ctx: Context): Promise<boolean> {
  const [{ data: open }, { data: conv }] = await Promise.all([
    ctx.admin.from('messages').select('id').eq('conversation_id', ctx.conversationId).in('kind', ['ritiro', 'offerta']).eq('offer_status', 'in_attesa').not('pickup_at', 'is', null).limit(1),
    ctx.admin.from('conversations').select('pickup_at, pickup_outcome').eq('id', ctx.conversationId).single(),
  ]);
  return !open?.length && !(conv?.pickup_at && !conv.pickup_outcome && new Date(conv.pickup_at) > new Date());
}

/** Proposta di ritiro a nome di chi vende, nel comune dell'annuncio. */
async function proposePickup(ctx: Context, slot: string): Promise<void> {
  const listing = getListing(ctx.listingId);
  const { error } = await ctx.admin.from('messages').insert({
    conversation_id: ctx.conversationId,
    sender_id: ctx.sellerId,
    kind: 'ritiro',
    offer_status: 'in_attesa',
    pickup_at: slot,
    pickup_place: listing ? (getComune(listing.comuneId)?.name ?? null) : null,
    by_assistant: true,
  });
  if (error) throw new Error(error.message);
}

async function run(conversationId: string, buyerId: string, sent: Sent): Promise<void> {
  const ctx = await contextFor(conversationId);
  if (!ctx || ctx.buyerId !== buyerId) return;
  const listing = getListing(ctx.listingId);
  if (!listing) return;

  // Offerta sotto il minimo: rifiutata subito, senza dire qual è il minimo
  if (sent.offerId && sent.offerChf) {
    const { data: rule } = await ctx.admin.from('listing_settings').select('min_offer_chf').eq('listing_id', ctx.listingId).maybeSingle();
    const min = rule?.min_offer_chf != null ? Number(rule.min_offer_chf) : null;
    if (min != null && sent.offerChf < min) {
      const { data: declined } = await ctx.admin
        .from('messages')
        .update({ offer_status: 'rifiutata' })
        .eq('id', sent.offerId)
        .eq('offer_status', 'in_attesa')
        .select('id');
      if (declined?.length) {
        await say(ctx, `Grazie per l'offerta di ${formatChf(sent.offerChf)}, ma è troppo bassa per ${ctx.sellerName}. Se vuoi, proponi una cifra più alta.`);
      }
    }
  }

  const text = sent.text?.trim();
  if (!text) return;
  // Chi vende sta già rispondendo? Troppe risposte automatiche oggi?
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data: recent } = await ctx.admin
    .from('messages')
    .select('created_at, by_assistant')
    .eq('conversation_id', ctx.conversationId)
    .eq('sender_id', ctx.sellerId)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);
  const lastHuman = recent?.find((m) => !m.by_assistant);
  if (lastHuman && Date.now() - new Date(lastHuman.created_at).getTime() < SELLER_ACTIVE_MS) return;
  if ((recent?.filter((m) => m.by_assistant).length ?? 0) >= DAILY_REPLIES) return;

  const reply = await compose(ctx, listing, text, (await canProposePickup(ctx)) ? nextSlots(ctx.availability) : []);
  if (reply.text) await say(ctx, reply.text);
  if (reply.slot) await proposePickup(ctx, reply.slot);
}

/** Con Claude se c'è la chiave (e se risponde), altrimenti con le regole. */
async function compose(ctx: Context, listing: NonNullable<ReturnType<typeof getListing>>, text: string, slots: string[]): Promise<AssistantReply> {
  const key = claudeKey();
  if (key) {
    try {
      const out = await answerBuyer(key, {
        sellerName: ctx.sellerName,
        facts: listingFacts(listing),
        publicAnswers: (listing.questions ?? []).filter((q) => q.answer).map((q) => ({ question: q.body, answer: q.answer! })),
        message: text,
      });
      const pickup = out.asksPickupTime || intentsOf(text).includes('quando') ? slotText(slots) : null;
      const parts = [out.answer, pickup?.text].filter(Boolean);
      return { text: parts.length ? parts.join(' ') : null, slot: pickup?.slot ?? null };
    } catch (error) {
      if (!(error instanceof ClaudeError)) throw error;
      console.warn(`[giro] assistente venditore: ${error.message} Uso le regole.`);
    }
  }
  return ruleReply({ text, listing, sellerName: ctx.sellerName, slots });
}

async function proposePickupAfterDeal(conversationId: string): Promise<void> {
  const ctx = await contextFor(conversationId);
  if (!ctx) return;
  const [slot] = nextSlots(ctx.availability);
  if (!slot || !(await canProposePickup(ctx))) return;
  await say(ctx, `Grazie! Per il ritiro ti propongo ${formatPickup(slot)}: trovi la proposta qui sotto. Se non ti va bene, proponi tu giorno e ora.`);
  await proposePickup(ctx, slot);
}
