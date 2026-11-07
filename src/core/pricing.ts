import type { CategoryId } from './types.ts';

/**
 * Prezzi di giro.shop, in un posto solo. Pubblicare per i privati resta gratis, tranne auto, moto e affitti.
 * Le tariffe per categoria sono anche nel database (tabella listing_fees, controllate da un trigger):
 * se cambi PAID_CATEGORIES, cambia anche quella (lo verifica `pnpm test:db`).
 */

export const PRO_PLANS = {
  mese: { label: 'Un mese', chf: 12.9, months: 1 },
  anno: { label: 'Un anno', chf: 119.88, months: 12 },
} as const;
export type ProPlan = keyof typeof PRO_PLANS;

/** Vetrina mirata: avviso a chi cerca l'oggetto e primo posto nelle sue ricerche per una settimana. */
export const VETRINA = { chf: 3, days: 7 } as const;

/** Pubblicazione a pagamento, per categoria (gratis per i negozi Pro). */
export const PAID_CATEGORIES: Partial<Record<CategoryId, number>> = { auto: 9.9, moto_scooter: 4.9, affitti: 19.9 };

export function listingFee(category: CategoryId): number | null {
  return PAID_CATEGORIES[category] ?? null;
}

/** Commissione del pagamento protetto, a carico di chi compra: 5% + 50 centesimi, al massimo 30 franchi. */
export const PROTECTED_FEE = { pct: 5, fixed: 0.5, max: 30 } as const;

/** Arrotonda ai 5 centesimi, come si paga in Svizzera. */
export function roundRappen(chf: number): number {
  return Math.round(chf * 20) / 20;
}

export function protectedFee(itemChf: number): number {
  return roundRappen(Math.min(PROTECTED_FEE.max, (itemChf * PROTECTED_FEE.pct) / 100 + PROTECTED_FEE.fixed));
}
