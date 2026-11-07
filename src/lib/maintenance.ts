import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshListings } from '../core/store.ts';
import { digestCutoff, digestDue, emailRoute, type EmailPrefs, type NoticeKind } from '../core/email-prefs.ts';
import { adminClient } from './admin.ts';
import { digestMail, sendMail } from './mail.ts';
import { notify, siteOrigin, type Notice } from './notify.ts';
import { unsubscribeUrl } from './unsubscribe.ts';
import { warmUpSemantic } from './semantic.ts';
import { emailCard } from './email-content.ts';
import { formatDay } from '../core/format.ts';
import { claudeKey } from './claude.ts';
import { moderateWithAgent, pendingTargets } from './moderation-agent.ts';
import { applyPriceDrops, pickupReminders, sendPriceTips } from './seller-jobs.ts';
import { restoreExpiredBulk } from './pro.ts';
import { autoReleaseProtected } from './protected.ts';

/**
 * Lavori periodici del server, senza un programmatore esterno: partono al massimo ogni 15 minuti,
 * agganciati a una richiesta qualsiasi, e non la fanno aspettare.
 * - promemoria a chi vende 3 giorni prima della scadenza
 * - annunci scaduti: stato "scaduto", spariscono dal sito, chi vende li può rinnovare
 * - il riassunto della sera per chi ha scelto "un riassunto al giorno"
 * - ricerca per significato: modello pronto e vettori degli annunci nuovi o cambiati
 * - per chi vende: ribassi automatici e consigli sul prezzo (vedi seller-jobs.ts)
 * - negozi Pro: prezzi di prima alla fine delle modifiche in blocco; pagamenti protetti rilasciati dopo il ritiro
 */
const EVERY_MS = 15 * 60_000;
const REMIND_DAYS = 3;
let lastRun = 0;
let running = false;


export function maybeRunMaintenance(origin: string, invalidate: () => Promise<void>): void {
  if (running || Date.now() - lastRun < EVERY_MS) return;
  lastRun = Date.now();
  running = true;
  void runMaintenance(siteOrigin(origin), invalidate)
    .catch((e) => console.warn(`[giro] manutenzione: ${(e as Error).message}`))
    .finally(() => {
      running = false;
    });
}

export async function runMaintenance(
  origin: string,
  invalidate: () => Promise<void> = async () => {},
): Promise<{ reminded: number; expired: number; digests: number }> {
  const admin = adminClient();
  if (!admin) return { reminded: 0, expired: 0, digests: 0 };
  const now = new Date();
  const soon = new Date(now.getTime() + REMIND_DAYS * 864e5);

  const { data: expiring } = await admin
    .from('listings')
    .select('id, title, seller_id, expires_at')
    .in('status', ['pubblicato', 'in_trattativa'])
    .is('expiry_notified_at', null)
    .gt('expires_at', now.toISOString())
    .lte('expires_at', soon.toISOString());
  const reminders: Notice[] = (expiring ?? []).map((l) => ({
    userId: l.seller_id,
    kind: 'scadenza',
    title: `«${l.title}» scade ${formatDay(l.expires_at)}`,
    body: 'Se è ancora in vendita, rinnovalo con un tocco: resta online altri 90 giorni.',
    url: `/miei-annunci#a-${l.id}`,
    listingId: l.id,
  }));
  if (reminders.length) {
    await notify(reminders, origin);
    await admin.from('listings').update({ expiry_notified_at: now.toISOString() }).in('id', reminders.map((r) => r.listingId!));
  }

  const { data: expired } = await admin
    .from('listings')
    .update({ status: 'scaduto' })
    .in('status', ['pubblicato', 'in_trattativa'])
    .lt('expires_at', now.toISOString())
    .select('id, title, seller_id');
  if (expired?.length) {
    await notify(
      expired.map((l) => ({
        userId: l.seller_id,
        kind: 'scadenza' as const,
        title: `«${l.title}» è scaduto`,
        body: 'Non è più visibile sul sito. Se è ancora disponibile, rinnovalo dai tuoi annunci.',
        url: `/miei-annunci#a-${l.id}`,
        listingId: l.id,
      })),
      origin,
    );
    await refreshListings(true);
    await invalidate();
  }
  await applyPriceDrops(admin, origin, invalidate, now);
  await sendPriceTips(admin, origin, now);
  await pickupReminders(admin, origin, now);
  await restoreExpiredBulk(invalidate, now);
  await autoReleaseProtected(origin, invalidate, now);
  // Segnalazioni che l'agente non ha ancora esaminato (server spento, errore, chiave aggiunta dopo)
  if (claudeKey()) {
    for (const target of await pendingTargets(admin)) {
      const outcome = await moderateWithAgent(target, origin);
      if (!('skipped' in outcome)) await invalidate();
    }
  }
  const digests = await sendDigests(admin, origin, now);
  await warmUpSemantic();
  return { reminded: reminders.length, expired: expired?.length ?? 0, digests };
}

/**
 * Riassunto della sera (dalle 18, ora svizzera), uno al giorno per chi l'ha scelto:
 * gli avvisi non ancora mandati per email e non ancora visti nel sito, senza i tipi spenti.
 * Chi non ha niente di nuovo non riceve niente.
 */
export async function sendDigests(admin: SupabaseClient, origin: string, now = new Date()): Promise<number> {
  const cutoff = digestCutoff(now);
  if (now < cutoff) return 0;
  const { data: people } = await admin
    .from('profiles')
    .select('id, email_mode, email_off, digest_sent_at')
    .eq('email_mode', 'riassunto')
    .or(`digest_sent_at.is.null,digest_sent_at.lt.${cutoff.toISOString()}`);
  let sent = 0;
  for (const person of people ?? []) {
    if (!digestDue(now, person.digest_sent_at ? new Date(person.digest_sent_at) : null)) continue;
    // Al massimo gli ultimi due giorni: chi riattiva il riassunto non riceve avvisi vecchi
    const since = new Date(Math.max(person.digest_sent_at ? new Date(person.digest_sent_at).getTime() : 0, now.getTime() - 2 * 864e5));
    const { data: pending } = await admin
      .from('notifications')
      .select('id, kind, title, body, url, listing_id')
      .eq('user_id', person.id)
      .is('emailed_at', null)
      .is('read_at', null)
      .gt('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(30);
    const prefs = person as unknown as EmailPrefs;
    const items = (pending ?? []).filter((n) => emailRoute(prefs, n.kind as NoticeKind) === 'riassunto');
    await admin.from('profiles').update({ digest_sent_at: now.toISOString() }).eq('id', person.id);
    if (!items.length) continue;
    const { data: user } = await admin.auth.admin.getUserById(person.id);
    const to = user.user?.email;
    if (!to) continue;
    const withCards = items.map((i) => ({ ...i, listing: emailCard(i.listing_id, origin, i.url, true) }));
    const ok = await sendMail(digestMail({ to, items: withCards, origin, unsubscribe: unsubscribeUrl(origin, person.id) }));
    if (!ok) continue;
    sent += 1;
    await admin.from('notifications').update({ emailed_at: now.toISOString() }).in('id', items.map((i) => i.id));
  }
  return sent;
}
