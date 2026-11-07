import { describe, expect, it } from 'vitest';
import { intentsOf, matchingAnswer, ruleReply } from '../src/core/assistant.ts';
import type { Listing } from '../src/core/types.ts';

const listing: Listing = {
  id: 'x',
  title: 'Bici da corsa Bianchi',
  description: 'Telaio 55, gomme nuove.',
  category: 'bici',
  tags: [],
  attributes: { telaio: '55' },
  priceChf: 450,
  negotiable: true,
  condition: 'buono',
  comuneId: 'lugano',
  publishedAt: '2026-11-01T10:00:00Z',
  status: 'pubblicato',
  seller: { name: 'Sara', verified: true },
  shipping: false,
  questions: [{ id: 'q', body: 'Il cambio è Shimano?', askerName: 'Luca', createdAt: '2026-11-02T10:00:00Z', answer: 'Sì, Shimano 105 a 11 velocità.', helpful: 2 }],
};
const now = new Date('2026-11-12T08:00:00Z');

describe('assistente venditore senza AI', () => {
  it('riconosce le domande ripetitive', () => {
    expect(intentsOf('Ciao, è ancora disponibile?')).toEqual(['disponibile']);
    expect(intentsOf('Dove si ritira? Si può spedire?')).toEqual(['dove', 'spedizione']);
    expect(intentsOf("Qual è l'ultimo prezzo?")).toEqual(['trattabile']);
    expect(intentsOf('Quando posso passare a vederla?')).toEqual(['quando']);
    expect(intentsOf('Bella bici!')).toEqual([]);
  });

  it('risponde con i dati dell\'annuncio', () => {
    const r = ruleReply({ text: 'Ciao, è ancora disponibile? Si può spedire?', listing, sellerName: 'Sara', slots: [], now });
    expect(r.text).toBe('Sì, è ancora disponibile. No, solo ritiro di persona a Lugano.');
    expect(r.slot).toBeNull();
  });

  it('in trattativa lo dice, e invita a lasciare un\'offerta', () => {
    const r = ruleReply({ text: 'È ancora disponibile?', listing: { ...listing, negotiating: true }, sellerName: 'Sara', slots: [], now });
    expect(r.text).toContain('in trattativa');
  });

  it('propone il primo orario libero quando chiedono quando passare', () => {
    const slots = ['2026-11-13T17:30:00.000Z', '2026-11-14T09:00:00.000Z'];
    const r = ruleReply({ text: 'Quando posso passare?', listing, sellerName: 'Sara', slots, now });
    expect(r.slot).toBe(slots[0]);
    expect(r.text).toContain('Ti propongo domani alle 18:30, oppure sabato 14 novembre alle 10:00');
  });

  it('usa le risposte già date nelle domande pubbliche', () => {
    expect(matchingAnswer('Che cambio ha? È uno Shimano?', listing.questions)?.answer).toBe('Sì, Shimano 105 a 11 velocità.');
    expect(ruleReply({ text: 'Il cambio è uno Shimano?', listing, sellerName: 'Sara', slots: [], now }).text).toContain('Shimano 105');
  });

  it('senza domande riconosciute non risponde', () => {
    expect(ruleReply({ text: 'Mi piace molto, ci penso', listing, sellerName: 'Sara', slots: [], now }).text).toBeNull();
  });
});
