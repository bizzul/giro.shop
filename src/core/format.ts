import type { Condition, PriceVerdict } from './types.ts';

export const CONDITION_LABEL: Record<Condition, string> = {
  nuovo: 'Nuovo',
  come_nuovo: 'Come nuovo',
  buono: 'Buono',
  usato: 'Usato',
  da_riparare: 'Da riparare',
};

/** Cosa vuol dire ogni condizione, con la stessa scala che usa la bozza (src/core/draft.ts). */
export const CONDITION_HINT: Record<Condition, string> = {
  nuovo: 'Mai usato',
  come_nuovo: 'Usato poco, nessun segno visibile',
  buono: "Segni d'uso leggeri",
  usato: "Segni d'uso evidenti, funziona",
  da_riparare: 'Ha difetti o non funziona',
};

export const VERDICT_LABEL: Record<PriceVerdict, string> = {
  sotto_mercato: 'Sotto mercato',
  prezzo_giusto: 'Prezzo giusto',
  sopra_mercato: 'Sopra mercato',
};

/** Formato svizzero: CHF 1'450.– per i prezzi interi, CHF 3'699.90 con i centesimi. */
/** Il prezzo come si legge sull'annuncio: per gli affitti è al mese. */
export function priceText(listing: { priceChf: number; category: string }): string {
  return listing.category === 'affitti' ? `${formatChf(listing.priceChf)} al mese` : formatChf(listing.priceChf);
}

export function formatChf(value: number): string {
  if (value === 0) return 'Regalo';
  const whole = Math.trunc(value);
  const cents = Math.round((value - whole) * 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return cents ? `CHF ${grouped}.${String(cents).padStart(2, '0')}` : `CHF ${grouped}.–`;
}

/** Fascia di prezzo compatta: CHF 400–540. */
export function formatChfRange(low: number, high: number): string {
  const g = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `CHF ${g(low)}–${g(high)}`;
}

export function formatKm(km: number): string {
  if (km < 1) return 'meno di 1 km';
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function formatAge(iso: string, now = new Date()): string {
  const hours = (now.getTime() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return 'adesso';
  if (hours < 24) return `${Math.floor(hours)} h fa`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  return new Date(iso).toLocaleDateString('it-CH', { day: 'numeric', month: 'short' });
}

export function isNew(iso: string, now = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() < 24 * 36e5;
}

/**
 * Giorno e mese con l'articolo giusto: "il 9 novembre", "l'8 novembre", "l'11 marzo".
 * Con prep "al": "al 9 novembre", "all'8 novembre".
 */
export function formatDay(iso: string, prep: 'il' | 'al' = 'il'): string {
  const text = new Date(iso).toLocaleDateString('it-CH', { day: 'numeric', month: 'long' });
  const vowel = /^(8|11)\b/.test(text);
  if (prep === 'al') return vowel ? `all'${text}` : `al ${text}`;
  return vowel ? `l'${text}` : `il ${text}`;
}
