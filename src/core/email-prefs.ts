/**
 * Preferenze per le email degli avvisi: quando (subito, un riassunto al giorno, mai) e per cosa.
 * Gli avvisi restano sempre nel sito, sotto la campanella: qui si decide solo l'email.
 */

export type EmailMode = 'subito' | 'riassunto' | 'mai';
export const EMAIL_MODES: EmailMode[] = ['subito', 'riassunto', 'mai'];

export const EMAIL_MODE_LABEL: Record<EmailMode, string> = {
  subito: 'Subito, una email per avviso',
  riassunto: 'Un riassunto al giorno, alle 18',
  mai: 'Mai, solo nel sito',
};

/** L'ora (Svizzera) in cui parte il riassunto del giorno. */
export const DIGEST_HOUR = 18;

/** Tipi di avviso, come nel database (enum notification_kind). */
export type NoticeKind =
  | 'ricerca'
  | 'prezzo'
  | 'venduto'
  | 'domanda'
  | 'risposta'
  | 'valutazione'
  | 'scadenza'
  | 'segnalazione'
  | 'contestazione'
  | 'consiglio'
  | 'ritiro'
  | 'pagamento';

export interface EmailGroup {
  key: string;
  label: string;
  kinds: NoticeKind[];
}

/**
 * I tipi che si possono spegnere uno per uno, raggruppati come li pensa una persona.
 * Le decisioni di moderazione (segnalazione, contestazione) non sono qui: arrivano sempre subito, tranne con "mai".
 */
export const EMAIL_GROUPS: EmailGroup[] = [
  { key: 'ricerche', label: 'Nuovi annunci per le tue ricerche salvate', kinds: ['ricerca'] },
  { key: 'salvati', label: 'Prezzo ridotto o venduto, per gli annunci che hai salvato', kinds: ['prezzo', 'venduto'] },
  { key: 'domande', label: 'Domande sui tuoi annunci e risposte alle tue', kinds: ['domanda', 'risposta'] },
  { key: 'valutazioni', label: 'Valutazioni che ricevi', kinds: ['valutazione'] },
  { key: 'scadenze', label: 'Annunci tuoi in scadenza', kinds: ['scadenza'] },
  { key: 'consigli', label: "Consigli sui tuoi annunci: ribassi fatti, prezzo da rivedere, «l'hai venduto?»", kinds: ['consiglio'] },
  { key: 'ritiri', label: 'Promemoria dei ritiri concordati', kinds: ['ritiro'] },
];

/** Moderazione e pagamenti: arrivano sempre subito (tranne con "mai"), non si spengono per tipo. */
const ALWAYS_NOW: NoticeKind[] = ['segnalazione', 'contestazione', 'pagamento'];

export interface EmailPrefs {
  email_mode: EmailMode;
  email_off: NoticeKind[];
}

export const DEFAULT_PREFS: EmailPrefs = { email_mode: 'subito', email_off: [] };

/** Il gruppo di un tipo di avviso (per il link "non voglio più queste email"). */
export function groupOf(kind: NoticeKind): EmailGroup | undefined {
  return EMAIL_GROUPS.find((g) => g.kinds.includes(kind));
}

export function groupByKey(key: string | null | undefined): EmailGroup | undefined {
  return EMAIL_GROUPS.find((g) => g.key === key);
}

/** Come arriva per email un avviso: subito, nel riassunto, oppure niente email. */
export function emailRoute(prefs: EmailPrefs | null | undefined, kind: NoticeKind): 'subito' | 'riassunto' | null {
  const p = prefs ?? DEFAULT_PREFS;
  if (p.email_mode === 'mai') return null;
  if (ALWAYS_NOW.includes(kind)) return 'subito';
  if (p.email_off.includes(kind)) return null;
  return p.email_mode;
}

/** Dai gruppi accesi nel modulo ai tipi spenti da salvare. Chiavi sconosciute: ignorate. */
export function offKindsFromGroups(onGroups: string[]): NoticeKind[] {
  const on = new Set(onGroups);
  return EMAIL_GROUPS.filter((g) => !on.has(g.key)).flatMap((g) => g.kinds);
}

/** Un gruppo è acceso se nessuno dei suoi tipi è spento. */
export function groupIsOn(prefs: EmailPrefs | null | undefined, group: EmailGroup): boolean {
  const off = prefs?.email_off ?? [];
  return group.kinds.every((k) => !off.includes(k));
}

/** In breve, per i collegamenti ("Email: subito, 4 tipi su 5"). */
export function prefsSummary(prefs: EmailPrefs | null | undefined): string {
  const p = prefs ?? DEFAULT_PREFS;
  if (p.email_mode === 'mai') return 'Email spente';
  const on = EMAIL_GROUPS.filter((g) => groupIsOn(p, g)).length;
  const when = p.email_mode === 'riassunto' ? 'Email: un riassunto al giorno' : 'Email: subito';
  return on === EMAIL_GROUPS.length ? when : `${when}, ${on} tipi su ${EMAIL_GROUPS.length}`;
}

/**
 * Le 18 di oggi in Svizzera, come istante. Gestisce l'ora legale leggendo lo scarto di Europe/Zurich.
 */
export function digestCutoff(now: Date, hour = DIGEST_HOUR): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // "GMT+01:00" oppure "GMT" (scarto zero)
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:00:00${offset}`);
}

/** È ora di mandare il riassunto a chi l'ha ricevuto l'ultima volta in `lastSent`? */
export function digestDue(now: Date, lastSent: Date | null): boolean {
  const cutoff = digestCutoff(now);
  return now >= cutoff && (!lastSent || lastSent < cutoff);
}
