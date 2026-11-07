import type { SupabaseClient } from '@supabase/supabase-js';
import { photoUrl } from '../core/store.ts';

export type OfferStatus = 'in_attesa' | 'accettata' | 'rifiutata' | 'ritirata';

export interface Message {
  id: number;
  senderId: string;
  kind: 'testo' | 'offerta' | 'sistema' | 'ritiro';
  body: string;
  offerChf: number | null;
  /** Stato di un'offerta o di una proposta di ritiro. */
  offerStatus: OfferStatus | null;
  /** Giorno e ora del ritiro proposto (proposta di ritiro, o offerta con il ritiro). */
  pickupAt: string | null;
  pickupPlace: string | null;
  /** Scritto dall'assistente venditore a nome di chi vende. */
  byAssistant: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface ConversationSummary {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPrice: number;
  listingStatus: string;
  cover: string | null;
  role: 'compro' | 'vendo';
  otherName: string;
  lastMessage: Message | null;
  lastMessageAt: string;
  unread: number;
}

export interface Conversation extends Omit<ConversationSummary, 'lastMessage' | 'unread'> {
  buyerId: string;
  sellerId: string;
  /** Comune di ritiro dell'annuncio: il luogo proposto di base. */
  listingComuneId: string | null;
  /** Ritiro fissato (una proposta accettata). */
  pickupAt: string | null;
  pickupPlace: string | null;
  pickupOutcome: 'venduto' | 'non_venduto' | null;
  messages: Message[];
}

interface MessageRow {
  id: number;
  sender_id: string;
  kind: Message['kind'];
  body: string;
  offer_chf: number | string | null;
  offer_status: OfferStatus | null;
  pickup_at?: string | null;
  pickup_place?: string | null;
  by_assistant?: boolean | null;
  created_at: string;
  read_at: string | null;
}

/** Le colonne di un messaggio. */
export const MESSAGE_COLUMNS = 'id, sender_id, kind, body, offer_chf, offer_status, pickup_at, pickup_place, by_assistant, created_at, read_at';

const toMessage = (m: MessageRow): Message => ({
  id: m.id,
  senderId: m.sender_id,
  kind: m.kind,
  body: m.body,
  offerChf: m.offer_chf != null ? Number(m.offer_chf) : null,
  offerStatus: m.offer_status,
  pickupAt: m.pickup_at ?? null,
  pickupPlace: m.pickup_place ?? null,
  byAssistant: Boolean(m.by_assistant),
  createdAt: m.created_at,
  readAt: m.read_at,
});

const SELECT_CONVERSATION = `
  id, listing_id, buyer_id, seller_id, last_message_at, pickup_at, pickup_place, pickup_outcome,
  listing:listings(title, price_chf, status, comune_id, photos:listing_photos(storage_path, position)),
  buyer:profiles!conversations_buyer_id_fkey(display_name),
  seller:profiles!conversations_seller_id_fkey(display_name)
`;

interface ConversationRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  last_message_at: string;
  pickup_at?: string | null;
  pickup_place?: string | null;
  pickup_outcome?: 'venduto' | 'non_venduto' | null;
  listing: { title: string; price_chf: number | string; status: string; comune_id?: string; photos: Array<{ storage_path: string; position: number }> } | null;
  buyer: { display_name: string } | null;
  seller: { display_name: string } | null;
}

function base(row: ConversationRow, userId: string) {
  const cover = [...(row.listing?.photos ?? [])].sort((a, b) => a.position - b.position)[0]?.storage_path;
  const role = row.buyer_id === userId ? 'compro' : 'vendo';
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing?.title ?? 'Annuncio rimosso',
    listingPrice: Number(row.listing?.price_chf ?? 0),
    listingStatus: row.listing?.status ?? 'archiviato',
    cover: cover ? photoUrl(cover) : null,
    role,
    otherName: (role === 'compro' ? row.seller?.display_name : row.buyer?.display_name) ?? 'Utente',
    lastMessageAt: row.last_message_at,
  } as const;
}

/** Tutte le conversazioni dell'utente, come acquirente e come venditore, con i non letti. */
export async function listConversations(supabase: SupabaseClient, userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(`${SELECT_CONVERSATION}, messages(${MESSAGE_COLUMNS})`)
    .order('last_message_at', { ascending: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' });
  if (error) throw new Error(error.message);

  const unread = await unreadByConversation(supabase, userId);
  return (data as unknown as Array<ConversationRow & { messages: MessageRow[] }>).map((row) => ({
    ...base(row, userId),
    lastMessage: row.messages?.[0] ? toMessage(row.messages[0]) : null,
    unread: unread.get(row.id) ?? 0,
  }));
}

async function unreadByConversation(supabase: SupabaseClient, userId: string): Promise<Map<string, number>> {
  const { data } = await supabase.from('messages').select('conversation_id').is('read_at', null).neq('sender_id', userId).limit(1000);
  const counts = new Map<string, number>();
  for (const m of data ?? []) counts.set(m.conversation_id, (counts.get(m.conversation_id) ?? 0) + 1);
  return counts;
}

/** Numero di messaggi non letti, per l'intestazione. */
export async function unreadCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).is('read_at', null).neq('sender_id', userId);
  return count ?? 0;
}

/** Una conversazione con tutti i messaggi; segna come letti quelli ricevuti. */
export async function getConversation(supabase: SupabaseClient, userId: string, id: string): Promise<Conversation | null> {
  const { data, error } = await supabase.from('conversations').select(SELECT_CONVERSATION).eq('id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ConversationRow;

  const { data: messages } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(500);

  await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', id).neq('sender_id', userId).is('read_at', null);

  return {
    ...base(row, userId),
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    listingComuneId: row.listing?.comune_id ?? null,
    pickupAt: row.pickup_at ?? null,
    pickupPlace: row.pickup_place ?? null,
    pickupOutcome: row.pickup_outcome ?? null,
    messages: (messages as MessageRow[] | null)?.map(toMessage) ?? [],
  };
}

/** Conversazione già aperta dall'utente su un annuncio, se c'è. */
export async function findConversation(supabase: SupabaseClient, userId: string, listingId: string): Promise<string | null> {
  const { data } = await supabase.from('conversations').select('id').eq('listing_id', listingId).eq('buyer_id', userId).maybeSingle();
  return data?.id ?? null;
}
