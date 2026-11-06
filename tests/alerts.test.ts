import { describe, expect, it } from 'vitest';
import { matchesSearch } from '../src/core/search.ts';
import { parseQuery } from '../src/core/query.ts';
import { getListing } from '../src/core/store.ts';
import { ruleHighlights } from '../src/core/highlights.ts';
import { dealOfTheDay } from '../src/core/deals.ts';
import { estimatePrice, priceVerdict } from '../src/core/price.ts';

const base = getListing('l-001')!;
const fake = (patch: Partial<typeof base>) => ({ ...base, id: 'x', ...patch });

describe('ricerche salvate', () => {
  it('avvisa solo per lo stesso oggetto, nel budget e nella zona', () => {
    const desk = fake({ title: 'Scrivania in noce', priceChf: 120, comuneId: 'lugano' });
    expect(matchesSearch('scrivania sotto 150 franchi vicino a Lugano', desk)).toBe(true);
    expect(matchesSearch('scrivania sotto 100 franchi', desk)).toBe(false);
    expect(matchesSearch('scrivania a Locarno', desk)).toBe(false);
    // Una lampada "da scrivania" non avvisa chi cerca scrivanie
    expect(matchesSearch('scrivania', fake({ title: 'Lampada da scrivania in ottone', category: 'arredamento' }))).toBe(false);
  });

  it('capisce "con spedizione" e lo usa come filtro', () => {
    const { filters, chips } = parseQuery('lampada con spedizione');
    expect(filters.shipping).toBe(true);
    expect(chips.find((c) => c.key === 'Consegna')).toMatchObject({ value: 'si spedisce', without: 'lampada' });
    const lamp = fake({ title: 'Lampada in ottone', description: 'Funziona.', shipping: false });
    expect(matchesSearch('lampada con spedizione', lamp)).toBe(false);
    expect(matchesSearch('lampada con spedizione', { ...lamp, shipping: true })).toBe(true);
  });
});

describe('in sintesi senza Claude', () => {
  it('stato, consegna e prezzo in tre righe', () => {
    const listing = fake({ condition: 'buono', comuneId: 'agno', shipping: true, shippingChf: 9, attributes: { misure: '120×60 cm' } });
    const estimate = estimatePrice({ text: listing.title, category: listing.category, condition: listing.condition, excludeId: 'l-001' });
    const points = ruleHighlights(listing, estimate, priceVerdict(base));
    expect(points[0]).toBe('In buono stato · misure 120×60 cm');
    expect(points[1]).toBe('Ritiro ad Agno, spedizione CHF 9.–');
    expect(points).toHaveLength(3);
  });
});

describe('affare del giorno', () => {
  it('sceglie un annuncio recente sotto il prezzo dei simili, o nessuno', () => {
    const deal = dealOfTheDay();
    if (deal) {
      expect(priceVerdict(deal.listing)).toBe('sotto_mercato');
      expect(deal.savingPct).toBeGreaterThan(0);
    }
    // Lontano nel futuro nessun annuncio è recente: niente affare
    expect(dealOfTheDay(new Date('2030-01-01'))).toBeNull();
  });
});
