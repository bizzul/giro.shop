import { describe, expect, it } from 'vitest';
import { demandFor, demandGroups, searchedObject, wantedBoard } from '../src/core/demand.ts';
import type { Listing } from '../src/core/types.ts';

const bike: Listing = {
  id: 'bozza',
  title: 'Bici da corsa Bianchi',
  description: 'Telaio 55, cambio Shimano.',
  category: 'bici',
  tags: ['bici da corsa', 'bianchi'],
  attributes: {},
  priceChf: 950,
  condition: 'buono',
  comuneId: 'lugano',
  publishedAt: '2026-11-07T10:00:00Z',
  status: 'pubblicato',
  seller: { name: 'Sara', verified: true },
  sellerId: 'sara',
};

describe('lo cercano in 4', () => {
  const searches = [
    { userId: 'a', query: 'bici da corsa sotto i 900 franchi' },
    { userId: 'b', query: 'bici da corsa max 700' },
    { userId: 'b', query: 'bici da corsa bianchi' },
    { userId: 'c', query: 'bici da corsa' },
    { userId: 'd', query: 'passeggino trio' },
    { userId: 'sara', query: 'bici da corsa' },
  ];

  it('conta le persone, non le ricerche, e ignora chi vende', () => {
    expect(demandFor(bike, searches).people).toBe(3);
  });

  it('conta anche chi ha un budget più basso del prezzo, e dice i budget', () => {
    expect(demandFor(bike, searches).budget).toEqual({ low: 700, high: 900, count: 2 });
  });

  it('un solo budget non si mostra', () => {
    expect(demandFor(bike, searches.filter((s) => s.userId !== 'b')).budget).toBeNull();
  });
});

describe('Cercasi', () => {
  it('raggruppa per oggetto e zona, solo con almeno due persone', () => {
    const groups = demandGroups([
      { userId: 'a', query: 'bici da corsa sotto i 900 franchi' },
      { userId: 'b', query: 'bici da corsa max 700' },
      { userId: 'c', query: 'Bici da corsa Bianchi' },
      { userId: 'd', query: 'mountain bike a Bellinzona' },
      { userId: 'e', query: 'mountain bike a Bellinzona max 600' },
      { userId: 'f', query: 'passeggino trio' },
    ]);
    expect(groups).toEqual([
      { label: 'Bici da corsa', query: 'bici da corsa', district: null, people: 3, budget: 700 },
      { label: 'Mountain bike', query: 'mountain bike', district: 'Bellinzona', people: 2, budget: null },
    ]);
  });
});

describe('ricerche contate, anonime', () => {
  it("si tiene solo l'oggetto riconosciuto e la zona, mai la frase", () => {
    expect(searchedObject('bici da corsa Bianchi sotto i 900 franchi a Bellinzona')).toEqual({ term: 'bici da corsa', label: 'Bici da corsa', district: 'Bellinzona' });
    expect(searchedObject('regalo per mia nonna')).toBeNull();
  });

  it('persone e ricerche insieme, per oggetto e zona', () => {
    const board = wantedBoard(
      [
        { userId: 'a', query: 'bici da corsa' },
        { userId: 'b', query: 'bici da corsa max 700' },
        { userId: 'c', query: 'passeggino trio' },
      ],
      [
        { label: 'Bici da corsa', district: '', searches: 4 },
        { label: 'Snowboard', district: 'Lugano', searches: 3 },
        { label: 'Passeggini', district: '', searches: 2 },
      ],
    );
    expect(board).toEqual([
      { label: 'Bici da corsa', query: 'bici da corsa', district: null, people: 2, budget: null, searches: 4 },
      { label: 'Snowboard', query: 'snowboard', district: 'Lugano', people: 0, budget: null, searches: 3 },
    ]);
  });
});
