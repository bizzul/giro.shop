import type { SupabaseClient } from '@supabase/supabase-js';
import { photoUrl } from '../core/store.ts';

export type OfferStatus = 'in_attesa' | 'accettata' | 'rifiutata' | 'ritirata';

export interface Message {
  id: number;
  senderId: string;
  kind: 'testo' | 'offerta' | 'sistema';
  body: string;
  offerChf: number | null;
  offerStatus: OfferStatus | null;
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
  messages: Message[];
}

interface MessageRow {
  id: number;
  sender_id: string;
  kind: Message['kind'];
  body: string;
  offer_chf: number | string | null;
  offer_status: OfferStatus | null;
  created_at: string;
  read_at: string | null;
}

const toMessage = (m: MessageRow): Message => ({
  id: m.id,
  senderId: m.sender_id,
  kind: m.kind,
  body: m.body,
  offerChf: m.offer_chf != null ? Number(m.offer_chf) : null,
  offerStatus: m.offer_status,
  createdAt: m.created_at,
  readAt: m.read_at,
});

const SELECT_CONVERSATION = `
  id, listing_id, buyer_id, seller_id, last_message_at,
  listing:listings(title, price_chf, status, photos:listing_photos(storage_path, position)),
  buyer:profiles!conversations_buyer_id_fkey(display_name),
  seller:profiles!conversations_seller_id_fkey(display_name)
`;

interface ConversationRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  last_message_at: string;
  listing: { title: string; price_chf: number | string; status: string; photos: Array<{ storage_path: string; position: number }> } | null;
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
    .select(`${SELECT_CONVERSATION}, messages(id, sender_id, kind, body, offer_chf, offer_status, created_at, read_at)`)
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
    .select('id, sender_id, kind, body, offer_chf, offer_status, created_at, read_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(500);

  await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', id).neq('sender_id', userId).is('read_at', null);

  return {
    ...base(row, userId),
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    messages: (messages as MessageRow[] | null)?.map(toMessage) ?? [],
  };
}

/** Conversazione già aperta dall'utente su un annuncio, se c'è. */
export async function findConversation(supabase: SupabaseClient, userId: string, listingId: string): Promise<string | null> {
  const { data } = await supabase.from('conversations').select('id').eq('listing_id', listingId).eq('buyer_id', userId).maybeSingle();
  return data?.id ?? null;
}
