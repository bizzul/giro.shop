import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './admin.ts';
import { noticeMail, sendMail } from './mail.ts';
import { unsubscribeUrl } from './unsubscribe.ts';

export type NoticeKind = 'ricerca' | 'prezzo' | 'venduto' | 'domanda' | 'risposta' | 'valutazione' | 'scadenza' | 'segnalazione' | 'contestazione';

export interface Notice {
  userId: string;
  kind: NoticeKind;
  title: string;
  body?: string;
  /** Percorso interno del sito, es. /annuncio/l-001#domande */
  url: string;
  listingId?: string;
}

/** Indirizzo pubblico del sito per i link nelle email. */
export function siteOrigin(fallback: string): string {
  return import.meta.env?.PIAZZA_BASE_URL ?? process.env.PIAZZA_BASE_URL ?? fallback;
}

/**
 * Crea gli avvisi (campanella nel sito) e manda un'email per ciascuno.
 * Le email partono dopo, senza far aspettare chi ha fatto l'azione.
 */
export async function notify(notices: Notice[], origin: string): Promise<void> {
  const admin = adminClient();
  if (!admin || notices.length === 0) return;
  const { data, error } = await admin
    .from('notifications')
    .insert(
      notices.map((n) => ({
        user_id: n.userId,
        kind: n.kind,
        title: n.title,
        body: n.body ?? '',
        url: n.url,
        listing_id: n.listingId ?? null,
      })),
    )
    .select('id');
  if (error || !data) {
    console.warn(`[giro] avvisi non salvati: ${error?.message}`);
    return;
  }
  const ids = data.map((r) => r.id as string);
  void emailNotices(admin, notices, ids, origin).catch((e) => console.warn(`[giro] email degli avvisi: ${(e as Error).message}`));
}

async function emailNotices(admin: SupabaseClient, notices: Notice[], ids: string[], origin: string): Promise<void> {
  // Chi ha spento le email riceve gli avvisi solo nel sito
  const users = [...new Set(notices.map((n) => n.userId))];
  const { data: prefs } = await admin.from('profiles').select('id, notify_email').in('id', users);
  const wants = new Set((prefs ?? []).filter((p) => p.notify_email).map((p) => p.id as string));
  const emails = new Map<string, string | null>();
  for (const [i, n] of notices.entries()) {
    if (!wants.has(n.userId)) continue;
    if (!emails.has(n.userId)) {
      const { data } = await admin.auth.admin.getUserById(n.userId);
      emails.set(n.userId, data.user?.email ?? null);
    }
    const to = emails.get(n.userId);
    if (!to) continue;
    const unsubscribe = unsubscribeUrl(origin, n.userId);
    const sent = await sendMail(noticeMail({ to, title: n.title, body: n.body ?? '', url: n.url, origin, unsubscribe }));
    if (sent) await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', ids[i]);
  }
}

/** Chi ha salvato un annuncio (per avvisarlo di prezzo e vendita). */
export async function favoritersOf(listingId: string): Promise<string[]> {
  const admin = adminClient();
  if (!admin) return [];
  const { data } = await admin.from('favorites').select('user_id').eq('listing_id', listingId);
  return (data ?? []).map((r) => r.user_id as string);
}
