import { roundRappen } from './pricing.ts';
import { normalize } from './text.ts';
import { zurichDay, zurichToIso } from './pickup.ts';

/**
 * Modifiche in blocco per i negozi Pro, scritte a parole:
 * "tutti gli sci -20% fino a domenica", "biciclette +5%", "sconto del 10% su tutto per 7 giorni".
 * Da una frase: di quanto cambia il prezzo, fino a quando, e cosa resta per scegliere gli annunci.
 */

export interface BulkPhrase {
  /** Variazione in percento: negativa per uno sconto. */
  pct: number;
  /** Quando tornano i prezzi di prima (fine giornata, ora svizzera); null = per sempre. */
  endsAt: string | null;
  /** Cosa scegliere, come frase di ricerca; vuota = tutti gli annunci. */
  query: string;
}

const WEEKDAYS = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const FILLER = new Set(['tutti', 'tutte', 'tutto', 'gli', 'le', 'i', 'il', 'la', 'lo', 'l', 'annunci', 'annuncio', 'sconto', 'sconti', 'ribasso', 'aumento', 'aumenta', 'alza', 'abbassa', 'sconta', 'metti', 'saldi', 'del', 'di', 'su', 'sui', 'sulle', 'sugli', 'per', 'prezzi', 'prezzo', 'meno', 'piu', 'e', 'a', 'da', 'miei', 'mie']);

const endOf = (day: string) => new Date(new Date(zurichToIso(day, '23:59')!).getTime() + 59_000).toISOString();
const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export function parseBulk(phrase: string, now = new Date()): BulkPhrase | { error: string } {
  let n = ` ${normalize(phrase.replace(/[−–]/g, '-'))} `;
  const raw = phrase.replace(/[−–]/g, '-');

  // Percentuale, con il segno scritto o detto a parole
  const m = raw.match(/([+-])?\s*(\d{1,2}(?:[.,]\d)?)\s*%/);
  if (!m) return { error: 'Scrivi di quanto cambia il prezzo, per esempio «-20%».' };
  const value = Number(m[2].replace(',', '.'));
  const up = m[1] === '+' || (/\b(aumenta|aumento|alza|piu)\b/.test(n) && m[1] !== '-');
  if (!(value > 0 && value <= 90)) return { error: 'La percentuale va da 1 a 90.' };
  const pct = up ? value : -value;
  n = n.replace(/\b\d{1,2}( \d)?\b(?= )/, ' ');

  // Fino a quando
  const today = zurichDay(now);
  let endsAt: string | null = null;
  const days = n.match(/\bper (\d{1,2}) giorn[oi]\b/);
  const weekday = n.match(/\bfino a (domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato)\b/);
  const date = n.match(/\bfino al? (\d{1,2}) (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/);
  if (days) {
    endsAt = endOf(addDays(today, Number(days[1]) - 1));
    n = n.replace(days[0], ' ');
  } else if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    const current = new Date(`${today}T12:00:00Z`).getUTCDay();
    endsAt = endOf(addDays(today, (target - current + 7) % 7 || 7));
    n = n.replace(weekday[0], ' ');
  } else if (date) {
    const [y] = today.split('-').map(Number);
    const month = MONTHS.indexOf(date[2]) + 1;
    let day = `${y}-${String(month).padStart(2, '0')}-${date[1].padStart(2, '0')}`;
    if (day < today) day = `${y + 1}${day.slice(4)}`;
    endsAt = endOf(day);
    n = n.replace(date[0], ' ');
  } else if (/\bfino a fine mese\b/.test(n)) {
    const [y, mo] = today.split('-').map(Number);
    endsAt = endOf(new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10));
    n = n.replace(/\bfino a fine mese\b/, ' ');
  }

  const query = n
    .split(' ')
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
    .join(' ');
  return { pct, endsAt, query };
}

/** Il nuovo prezzo: ai 5 centesimi, e senza centesimi sopra i 20 franchi. Mai sotto 1 franco. */
export function bulkPrice(price: number, pct: number): number {
  const next = price * (1 + pct / 100);
  return Math.max(1, next >= 20 ? Math.round(next) : roundRappen(next));
}
