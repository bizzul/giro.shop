import { describe, expect, it } from 'vitest';
import { dropPrice, dropSchedule, nextDropAt, priceTip, roundDown } from '../src/core/insights.ts';
import type { PriceEstimate } from '../src/core/types.ts';

const day = 864e5;
const from = '2026-11-01T10:00:00Z';
const at = (days: number) => new Date(new Date(from).getTime() + days * day);

describe('ribasso automatico', () => {
  const rule = { pct: 10, everyDays: 14, floorChf: 300, from };

  it('arrotonda a cifre da annuncio', () => {
    expect(roundDown(47.6)).toBe(47);
    expect(roundDown(143)).toBe(140);
    expect(roundDown(449)).toBe(440);
    expect(roundDown(1290)).toBe(1250);
  });

  it('aspetta i giorni scelti, poi scende', () => {
    expect(dropPrice(450, rule, at(13))).toBeNull();
    expect(dropPrice(450, rule, at(14))).toBe(400);
  });

  it("conta dall'ultimo ribasso", () => {
    const after = { ...rule, lastAt: at(14).toISOString() };
    expect(nextDropAt(after).toISOString()).toBe(at(28).toISOString());
    expect(dropPrice(400, after, at(20))).toBeNull();
  });

  it('non scende mai sotto il minimo e si ferma lì', () => {
    expect(dropPrice(320, rule, at(30))).toBe(300);
    expect(dropPrice(300, rule, at(60))).toBeNull();
  });

  it('i prezzi piccoli scendono comunque', () => {
    expect(dropPrice(9, { pct: 5, everyDays: 7, floorChf: 0, from }, at(7))).toBe(8);
  });

  it('mostra i ribassi che restano', () => {
    expect(dropSchedule(450, { pct: 10, floorChf: 300 })).toEqual([400, 360, 320, 300]);
  });
});

describe('consiglio sul prezzo', () => {
  const estimate: PriceEstimate = { low: 300, mid: 350, high: 400, comparables: 5, soldComparables: 2, basis: 'simili', confidence: 'alta', comparableIds: [] };
  const now = at(15);

  it('sopra il mercato e nessun contatto da 10 giorni: consiglia il massimo della fascia', () => {
    expect(priceTip({ priceChf: 480, publishedAt: from, estimate, now })).toMatchObject({ overPct: 20, suggested: 400, quietDays: 15 });
  });

  it('niente consiglio se qualcuno ha scritto da poco', () => {
    expect(priceTip({ priceChf: 480, publishedAt: from, lastContactAt: at(8).toISOString(), estimate, now })).toBeNull();
  });

  it('niente consiglio con un prezzo nella fascia o con una stima debole', () => {
    expect(priceTip({ priceChf: 390, publishedAt: from, estimate, now })).toBeNull();
    expect(priceTip({ priceChf: 480, publishedAt: from, estimate: { ...estimate, basis: 'categoria' }, now })).toBeNull();
    expect(priceTip({ priceChf: 480, publishedAt: from, estimate: null, now })).toBeNull();
  });
});
