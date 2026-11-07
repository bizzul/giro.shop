/**
 * Giorni e ore del ritiro, sempre in ora svizzera: dal modulo (giorno + ora) all'istante salvato,
 * dall'istante al testo ("sabato 14 novembre alle 10:00", "domani alle 18:30"),
 * e i prossimi orari liberi di chi vende per l'assistente venditore.
 */

export const TZ = 'Europe/Zurich';

/** Lo scarto di Europe/Zurich in un istante, es. "+01:00" (inverno) o "+02:00" (estate). */
function offsetAt(date: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  return !name || name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}

/** Giorno ("2026-11-14") e ora ("10:00") svizzeri → istante ISO; null se non sono validi. */
export function zurichToIso(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const at = new Date(`${day}T${time}:00${offsetAt(new Date(`${day}T12:00:00Z`))}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Il giorno svizzero di un istante, come "2026-11-14". */
export function zurichDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** L'ora svizzera di un istante, come "10:00". */
export function zurichTime(date: Date): string {
  return new Intl.DateTimeFormat('it-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** Aggiunge giorni di calendario a "2026-11-14". */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** "oggi alle 10:00", "domani alle 18:30", "sabato 14 novembre alle 10:00". */
export function formatPickup(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const day = zurichDay(at);
  const today = zurichDay(now);
  const time = zurichTime(at);
  if (day === today) return `oggi alle ${time}`;
  if (day === addDays(today, 1)) return `domani alle ${time}`;
  const date = at.toLocaleDateString('it-CH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  return `${date} alle ${time}`;
}

/** Quando chi vende è di solito libero per un ritiro. */
export const AVAILABILITY = [
  { key: 'sab-mattina', label: 'Sabato mattina', days: [6], time: '10:00' },
  { key: 'sab-pomeriggio', label: 'Sabato pomeriggio', days: [6], time: '15:00' },
  { key: 'domenica', label: 'Domenica', days: [0], time: '11:00' },
  { key: 'sere', label: 'Sere feriali, dopo le 18', days: [1, 2, 3, 4, 5], time: '18:30' },
  { key: 'pranzo', label: 'Pausa pranzo, nei giorni feriali', days: [1, 2, 3, 4, 5], time: '12:15' },
] as const;

export type AvailabilityKey = (typeof AVAILABILITY)[number]['key'];
export const AVAILABILITY_KEYS = AVAILABILITY.map((a) => a.key) as AvailabilityKey[];

/**
 * I prossimi orari di ritiro secondo le disponibilità di chi vende: almeno 12 ore da adesso,
 * al massimo uno per giorno, nelle prossime due settimane.
 */
export function nextSlots(keys: readonly string[], now = new Date(), count = 3): string[] {
  const chosen = AVAILABILITY.filter((a) => keys.includes(a.key));
  const earliest = now.getTime() + 12 * 36e5;
  const out: string[] = [];
  const today = zurichDay(now);
  for (let i = 0; i <= 14 && out.length < count; i++) {
    const day = addDays(today, i);
    const options = chosen
      .filter((a) => (a.days as readonly number[]).includes(weekday(day)))
      .map((a) => zurichToIso(day, a.time)!)
      .filter((iso) => new Date(iso).getTime() >= earliest)
      .sort();
    if (options.length) out.push(options[0]);
  }
  return out;
}
