import type { PriceEstimate } from './types.ts';

/**
 * Consigli per chi vende, senza AI: ribasso automatico e prezzo da rivedere.
 * Funzioni pure, usate dalla manutenzione (che applica i ribassi) e dalle pagine di chi vende.
 */

export const DROP_PCTS = [5, 10, 15, 20] as const;
export const DROP_DAYS = [7, 14, 21, 30] as const;

export interface DropRule {
  pct: number;
  everyDays: number;
  floorChf: number;
  /** Da quando vale la regola: il primo ribasso arriva dopo everyDays giorni da qui. */
  from: string;
  lastAt?: string | null;
}

/** Arrotonda verso il basso a una cifra "da annuncio": 1 franco sotto i 50, 5 sotto i 200, 10 sotto i 1000, poi 50. */
export function roundDown(chf: number): number {
  const step = chf < 50 ? 1 : chf < 200 ? 5 : chf < 1000 ? 10 : 50;
  return Math.floor(chf / step) * step;
}

/** Quando tocca il prossimo ribasso. */
export function nextDropAt(rule: DropRule): Date {
  const start = new Date(rule.lastAt ?? rule.from).getTime();
  return new Date(start + rule.everyDays * 864e5);
}

/**
 * Il prezzo dopo un ribasso, oppure null se non tocca ancora o se si è già al minimo.
 * Non scende mai sotto il minimo e scende sempre di almeno un franco.
 */
export function dropPrice(price: number, rule: DropRule, now = new Date()): number | null {
  if (price <= rule.floorChf || now < nextDropAt(rule)) return null;
  const next = Math.max(rule.floorChf, roundDown(price * (1 - rule.pct / 100)));
  if (next < price) return next;
  // Prezzi piccoli: l'arrotondamento non deve bloccare il ribasso
  const oneLess = Math.max(rule.floorChf, price - 1);
  return oneLess < price ? oneLess : null;
}

/** Tutti i ribassi che restano, fino al minimo: per mostrare "poi 405, 360, 320". */
export function dropSchedule(price: number, rule: Pick<DropRule, 'pct' | 'floorChf'>, max = 6): number[] {
  const out: number[] = [];
  let p = price;
  while (out.length < max) {
    const next = dropPrice(p, { ...rule, everyDays: 0, from: new Date(0).toISOString() });
    if (next == null) break;
    out.push(next);
    p = next;
  }
  return out;
}

/** Dopo quanti giorni senza contatti un prezzo alto merita un consiglio. */
export const QUIET_DAYS = 10;

export interface PriceTip {
  /** Di quanto il prezzo supera la fascia degli annunci simili, in percento. */
  overPct: number;
  /** Il prezzo che suggeriamo: il massimo della fascia. */
  suggested: number;
  low: number;
  high: number;
  quietDays: number;
}

/**
 * "Nessun contatto in 12 giorni e sei il 20% sopra gli annunci simili": solo con una stima affidabile
 * (oggetti davvero simili, almeno tre) e solo per annunci in vendita da un po' senza nessuno che scrive.
 */
export function priceTip(input: {
  priceChf: number;
  publishedAt: string;
  lastContactAt?: string | null;
  estimate: PriceEstimate | null;
  now?: Date;
}): PriceTip | null {
  const { priceChf, estimate } = input;
  const now = input.now ?? new Date();
  if (!estimate || estimate.basis !== 'simili' || estimate.comparables < 3 || priceChf <= estimate.high) return null;
  const since = Math.max(new Date(input.publishedAt).getTime(), input.lastContactAt ? new Date(input.lastContactAt).getTime() : 0);
  const quietDays = Math.floor((now.getTime() - since) / 864e5);
  if (quietDays < QUIET_DAYS) return null;
  return {
    overPct: Math.round(((priceChf - estimate.high) / estimate.high) * 100),
    suggested: estimate.high,
    low: estimate.low,
    high: estimate.high,
    quietDays,
  };
}

/** Giorni tra due date (per "venduto in 6 giorni"). */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5));
}
