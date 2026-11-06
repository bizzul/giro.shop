import { describe, expect, it } from 'vitest';
import { MEANING_MIN, meaningMatches, meaningText, search } from '../src/core/search.ts';

// Similarità come le dà il modello per "sofà" sugli annunci di prova (vedi src/lib/semantic.ts)
const sofa = new Map([
  ['l-010', 0.64], // Divano 3 posti
  ['l-011', 0.58], // Poltrona Liberty
  ['l-001', 0.57],
  ['l-041', 0.45],
]);

describe('ricerca per significato', () => {
  it('tiene solo gli annunci sopra la soglia e vicini al più simile', () => {
    expect([...meaningMatches(sofa).keys()]).toEqual(['l-010']);
    // Più annunci quasi alla pari: entrano tutti
    expect([...meaningMatches(new Map([['a', 0.66], ['b', 0.63], ['c', 0.5]])).keys()]).toEqual(['a', 'b']);
    // Niente di abbastanza simile (parole a caso): nessuno
    expect(meaningMatches(new Map([['a', MEANING_MIN - 0.01]])).size).toBe(0);
  });

  it('cerca per significato solo la parte che dice che cosa', () => {
    expect(meaningText('sofà')).toBe('sofà');
    expect(meaningText('sofà sotto 300 franchi a Lugano')).toBe('sofà');
    expect(meaningText('sotto 100 franchi')).toBe('');
  });

  it('"sofà" trova il divano, che non contiene quella parola', () => {
    expect(search('sofà').total).toBe(0);
    const result = search('sofà', { meaning: meaningMatches(sofa) });
    expect(result.hits.map((h) => h.listing.id)).toEqual(['l-010']);
    expect(result.byMeaning).toBe(1);
    expect(result.hits[0].reasons[0]).toBe('stesso significato');
    expect(result.hits[0].meaning).toBe(0.64);
  });

  it('gli altri filtri valgono anche per significato', () => {
    // Il divano costa 250: sotto i 200 franchi non c'è
    expect(search('sofà sotto 200 franchi', { meaning: meaningMatches(sofa) }).total).toBe(0);
    expect(search('sofà sotto 300 franchi', { meaning: meaningMatches(sofa) }).total).toBe(1);
  });

  it('chi ha le parole cercate viene prima di chi ha solo lo stesso significato', () => {
    const meaning = new Map([['l-010', 0.7], ['l-011', 0.68]]);
    const hits = search('divano', { meaning }).hits;
    expect(hits[0].listing.id).toBe('l-010');
    expect(hits[0].meaning).toBeUndefined();
    expect(hits.find((h) => h.listing.id === 'l-011')?.meaning).toBe(0.68);
  });

  it('il dettaglio chiesto non si sostituisce', () => {
    // La poltrona è in velluto: "in pelle" la esclude anche se il significato è vicino
    const meaning = new Map([['l-011', 0.7]]);
    expect(search('poltrona in pelle', { meaning }).hits.some((h) => h.listing.id === 'l-011')).toBe(false);
  });
});
