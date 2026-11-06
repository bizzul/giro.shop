import { describe, expect, it } from 'vitest';
import { search } from '../src/core/search.ts';
import { estimatePrice, priceVerdict } from '../src/core/price.ts';
import { getListing } from '../src/core/store.ts';
import { isMainObject, mainObject } from '../src/core/match.ts';
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

describe('ordinamento e conteggio', () => {
  it('conta tutti i risultati anche se ne restituisce solo una parte', () => {
    const all = search('bici');
    const page = search('bici', { limit: 2 });
    expect(page.hits).toHaveLength(2);
    expect(page.total).toBe(all.total);
    expect(all.total).toBeGreaterThan(2);
  });

  it('ordina per prezzo, crescente e decrescente', () => {
    const up = search('bici', { sort: 'prezzo' }).hits.map((h) => h.listing.priceChf);
    const down = search('bici', { sort: 'prezzo-desc' }).hits.map((h) => h.listing.priceChf);
    expect(up).toEqual([...up].sort((a, b) => a - b));
    expect(down).toEqual([...down].sort((a, b) => b - a));
  });

  it('ordina per distanza quando la frase nomina un luogo', () => {
    const km = search('scrivania vicino a Lugano', { sort: 'vicini' }).hits.map((h) => h.distanceKm ?? Infinity);
    expect(km).toEqual([...km].sort((a, b) => a - b));
  });
});

describe('stesso oggetto, non solo nominato', () => {
  const fake = (title: string) => ({ ...getListing('l-001')!, id: `x-${title}`, title });

  it('una lampada da scrivania non è una scrivania, gli scarponi da sci non sono sci', () => {
    expect(isMainObject(fake('Lampada da scrivania in ottone'), ['scrivani'])).toBe(false);
    expect(isMainObject(fake('Scrivania bianca laccata'), ['scrivani'])).toBe(true);
    expect(isMainObject(fake('Scarponi da sci Lange'), ['sci'])).toBe(false);
    expect(isMainObject(fake('Bici da corsa Bianchi'), ['bici'])).toBe(true);
    // Titolo senza un oggetto riconoscibile: decide il testo
    expect(isMainObject(fake('Scatoloni da trasloco'), ['scrivani'])).toBe(true);
  });

  it('stima una bici da corsa solo con altre bici', () => {
    const est = estimatePrice({ text: 'bici da corsa Bianchi telaio 55' })!;
    expect(est.basis).toBe('simili');
    expect(est.comparableIds.every((id) => mainObject(getListing(id)!)?.startsWith('bici'))).toBe(true);
  });

  it('con pochi sci la stima viene dalla categoria e non dà un verdetto', () => {
    // Scarponi, casco e giacca da sci non contano più come sci: ne resta uno solo
    const est = estimatePrice({ text: 'Sci Atomic Redster 170 cm', category: 'sport_inverno', excludeId: 'l-024' })!;
    expect(est.basis).toBe('categoria');
    expect(priceVerdict(getListing('l-024')!)).toBeUndefined();
  });
});
