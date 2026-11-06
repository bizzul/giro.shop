import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './supabase.ts';

let client: SupabaseClient | null | undefined;
const anon = () => (client ??= SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null);

export interface SellerStats {
  name: string;
  memberSince: string;
  phoneVerified: boolean;
  sold: number;
  conversations: number;
  answered: number;
  medianReplyMinutes: number | null;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface Rating {
  stars: number;
  tags: string[];
  comment: string | null;
  createdAt: string;
  raterName: string;
}

/** Numeri pubblici su chi vende (nessun contenuto dei messaggi) e le sue ultime valutazioni. */
export async function sellerProfile(sellerId: string): Promise<{ stats: SellerStats | null; ratings: Rating[] }> {
  const c = anon();
  if (!c) return { stats: null, ratings: [] };
  const [{ data: rows }, { data: list }, { data: profile }] = await Promise.all([
    c.rpc('seller_stats', { seller: sellerId }),
    c
      .from('ratings')
      .select('stars, tags, comment, created_at, rater:profiles!ratings_rater_id_fkey(display_name)')
      .eq('rated_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(50),
    c.from('profiles').select('display_name').eq('id', sellerId).maybeSingle(),
  ]);
  const r = (rows as Array<Record<string, unknown>> | null)?.[0];
  const stats: SellerStats | null = r
    ? {
        name: profile?.display_name ?? 'Utente',
        memberSince: String(r.member_since),
        phoneVerified: Boolean(r.phone_verified),
        sold: Number(r.sold ?? 0),
        conversations: Number(r.conversations ?? 0),
        answered: Number(r.answered ?? 0),
        medianReplyMinutes: r.median_reply_minutes != null ? Number(r.median_reply_minutes) : null,
        ratingAvg: r.rating_avg != null ? Number(r.rating_avg) : null,
        ratingCount: Number(r.rating_count ?? 0),
      }
    : null;
  const ratings: Rating[] = ((list ?? []) as unknown as Array<{ stars: number; tags: string[]; comment: string | null; created_at: string; rater: { display_name: string } | null }>).map((x) => ({
    stars: x.stars,
    tags: x.tags ?? [],
    comment: x.comment,
    createdAt: x.created_at,
    raterName: x.rater?.display_name ?? 'Utente',
  }));
  return { stats, ratings };
}

/** "entro 20 minuti", "entro 3 ore", "entro 2 giorni" */
export function replyTime(minutes: number): string {
  if (minutes < 60) return `entro ${Math.max(5, Math.ceil(minutes / 5) * 5)} minuti`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return hours === 1 ? 'entro un\'ora' : `entro ${hours} ore`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? 'entro un giorno' : `entro ${days} giorni`;
}
