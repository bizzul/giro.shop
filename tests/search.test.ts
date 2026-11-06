import { describe, expect, it } from 'vitest';
import { search } from '../src/core/search.ts';
import { estimatePrice, priceVerdict } from '../src/core/price.ts';
import { getListing } from '../src/core/store.ts';
import { createDraft, DraftError } from '../src/core/draft.ts';

const ids = (q: string) => search(q).hits.map((h) => h.listing.id).sort();

describe('search', () => {
  it('trova solo scrivanie in legno, entro budget e vicino a Lugano', () => {
    // escluse: l-004 (non è legno), l-006 (Locarno, troppo lontano), l-007 (380 franchi), l-012/13 (vendute)
    expect(ids('scrivania in legno sotto i 150 franchi vicino a Lugano')).toEqual(['l-001', 'l-002', 'l-003', 'l-005']);
  });

  it('spiega perché ogni risultato è pertinente', () => {
    const hit = search('scrivania in legno sotto i 150 franchi vicino a Lugano').hits.find((h) => h.listing.id === 'l-001');
    expect(hit?.reasons[0]).toBe('noce massello');
    expect(hit?.distanceKm).toBeLessThan(2);
  });

  it('per una bimba di 6 anni propone bici da 16 a 20 pollici vicino a Bellinzona', () => {
    expect(ids('bici per una bimba di 6 anni, ritiro a Bellinzona')).toEqual(['l-020', 'l-021']);
  });

  it('filtra per decennio e prezzo massimo', () => {
    expect(ids("Vespa anni '80 anche da sistemare, massimo 2000")).toEqual(['l-031']);
  });
});

describe('estimatePrice', () => {
  it('stima una bici da corsa usando anche gli annunci venduti', () => {
    const est = estimatePrice({ text: 'bici da corsa Bianchi telaio 55', condition: 'buono' });
    expect(est).not.toBeNull();
    expect(est!.basis).toBe('simili');
    expect(est!.soldComparables).toBeGreaterThanOrEqual(2);
    expect(est!.low).toBeLessThan(est!.mid);
    expect(est!.mid).toBeGreaterThan(400);
    expect(est!.mid).toBeLessThan(520);
  });

  it('non giudica il prezzo di una bici per bambini confrontandola con le bici da adulto', () => {
    const kids = getListing('l-020')!;
    expect(priceVerdict(kids)).toBeUndefined();
    expect(priceVerdict(getListing('l-001')!)).toBe('prezzo_giusto');
  });

  it('abbassa la stima per un oggetto da riparare', () => {
    const buono = estimatePrice({ text: 'bici da corsa', condition: 'buono' })!;
    const rotto = estimatePrice({ text: 'bici da corsa', condition: 'da_riparare' })!;
    expect(rotto.mid).toBeLessThan(buono.mid);
  });
});

describe('createDraft senza Claude', () => {
  it('crea una bozza dal testo con regole semplici', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const draft = await createDraft({ notes: 'VENDO SCARPONI DA SCI LANGE 27.5, usati pochissimo', comune: 'Locarno' });
      expect(draft.source).toBe('regole');
      expect(draft.category).toBe('sport_inverno');
      expect(draft.condition).toBe('come_nuovo');
      expect(draft.title).toBe('Scarponi da sci lange 27.5');
      expect(draft.comune?.name).toBe('Locarno');
      expect(draft.price).not.toBeNull();
      expect(draft.warnings[0]).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('rifiuta una bozza vuota', async () => {
    await expect(createDraft({})).rejects.toBeInstanceOf(DraftError);
  });
});
