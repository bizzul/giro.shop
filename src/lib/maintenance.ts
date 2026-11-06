import { refreshListings } from '../core/store.ts';
import { adminClient } from './admin.ts';
import { notify, siteOrigin, type Notice } from './notify.ts';
import { formatDay } from '../core/format.ts';
import { claudeKey } from './claude.ts';
import { moderateWithAgent, pendingTargets } from './moderation-agent.ts';

/**
 * Lavori periodici del server, senza un programmatore esterno: partono al massimo ogni 15 minuti,
 * agganciati a una richiesta qualsiasi, e non la fanno aspettare.
 * - promemoria a chi vende 3 giorni prima della scadenza
 * - annunci scaduti: stato "scaduto", spariscono dal sito, chi vende li può rinnovare
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

export async function runMaintenance(origin: string, invalidate: () => Promise<void> = async () => {}): Promise<{ reminded: number; expired: number }> {
  const admin = adminClient();
  if (!admin) return { reminded: 0, expired: 0 };
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
  // Segnalazioni che l'agente non ha ancora esaminato (server spento, errore, chiave aggiunta dopo)
  if (claudeKey()) {
    for (const target of await pendingTargets(admin)) {
      const outcome = await moderateWithAgent(target, origin);
      if (!('skipped' in outcome)) await invalidate();
    }
  }
  return { reminded: reminders.length, expired: expired?.length ?? 0 };
}
