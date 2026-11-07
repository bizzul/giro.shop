import { describe, expect, it } from 'vitest';
import { listingRisk, messageWarnings, RISK_REVIEW } from '../src/core/risk.ts';
import type { PriceEstimate } from '../src/core/types.ts';

describe('rischio truffa nei messaggi', () => {
  it('riconosce gli schemi più diffusi', () => {
    expect(messageWarnings('Ti mando il mio corriere, paghi le spese e poi ti rimborso')[0]).toContain('corriere');
    expect(messageWarnings('Mandami il codice che ti arriva per SMS per confermare TWINT')[0]).toContain('codice');
    expect(messageWarnings('Per bloccarlo serve una caparra di 50 franchi')[0]).toContain('anticipo');
    expect(messageWarnings('Compila qui: https://twint-conferma.xyz/pagamento')[0]).toContain('link');
    expect(messageWarnings('Scrivimi su WhatsApp al 079 123 45 67')[0]).toContain('fuori da giro.shop');
    expect(messageWarnings('Mi servono numero della carta e CVV per mandarti i soldi')[0]).toContain('carta');
  });

  it('i messaggi normali non hanno avvisi', () => {
    expect(messageWarnings('Ciao, è ancora disponibile? Posso passare sabato mattina?')).toEqual([]);
    expect(messageWarnings('Pago in contanti al ritiro, va bene?')).toEqual([]);
    expect(messageWarnings('Il prezzo è di 120 franchi, trattabile')).toEqual([]);
  });
});

describe('rischio truffa negli annunci', () => {
  const estimate: PriceEstimate = { low: 800, mid: 1000, high: 1200, comparables: 6, soldComparables: 2, basis: 'simili', confidence: 'alta', comparableIds: [] };

  it('un annuncio normale resta sotto la soglia', () => {
    const r = listingRisk({ title: 'Bici da corsa', description: 'Telaio 55, ritiro a Lugano.', priceChf: 900, estimate, verified: true });
    expect(r.score).toBe(0);
  });

  it('prezzo stracciato, pagamento anticipato e WhatsApp: da guardare', () => {
    const r = listingRisk({ title: 'iPhone 16 Pro nuovo', description: 'Spedisco dopo bonifico anticipato, scrivimi su WhatsApp', priceChf: 150, estimate, verified: false });
    expect(r.score).toBeGreaterThanOrEqual(RISK_REVIEW);
    expect(r.signals).toEqual(expect.arrayContaining(['anticipo', 'fuori', 'prezzo']));
    expect(r.reasons).toContain('Cellulare non verificato');
  });

  it('un testo copiato da un altro annuncio conta', () => {
    expect(listingRisk({ title: 'Divano', description: 'Bel divano', priceChf: 300, estimate: null, copiedFrom: 'x' }).signals).toEqual(['copia']);
  });
});
