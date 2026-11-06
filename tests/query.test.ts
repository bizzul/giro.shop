import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/core/query.ts';
import { formatChf } from '../src/core/format.ts';

const chips = (q: string) => parseQuery(q).chips.map((c) => `${c.key}: ${c.value}`);

describe('parseQuery', () => {
  it('capisce oggetto, prezzo, zona e materiale', () => {
    const { filters } = parseQuery('scrivania in legno sotto i 150 franchi vicino a Lugano');
    expect(filters.category).toBe('arredamento');
    expect(filters.maxPrice).toBe(150);
    expect(filters.comuneId).toBe('lugano');
    expect(filters.radiusKm).toBe(15);
    expect(chips('scrivania in legno sotto i 150 franchi vicino a Lugano')).toEqual([
      'Categoria: Scrivanie',
      "Prezzo: ≤ CHF 150.–",
      'Zona: Lugano + 15 km',
      'Materiale: legno',
    ]);
  });

  it("traduce l'età del bambino in misura delle ruote", () => {
    const { filters } = parseQuery('bici per una bimba di 6 anni, ritiro a Bellinzona');
    expect(filters.category).toBe('bici');
    expect(filters.wheelRange).toEqual([16, 20]);
    expect(filters.comuneId).toBe('bellinzona');
    expect(filters.radiusKm).toBe(10);
    expect(filters.pickup).toBe(true);
  });

  it('riconosce decenni, prezzi svizzeri e oggetti da riparare', () => {
    const { filters } = parseQuery("Vespa anni '80 anche da sistemare, massimo 2'000");
    expect(filters.category).toBe('moto_scooter');
    expect(filters.yearFrom).toBe(1980);
    expect(filters.yearTo).toBe(1989);
    expect(filters.maxPrice).toBe(2000);
    expect(filters.includeBroken).toBe(true);
  });

  it("sceglie la categoria dall'oggetto nominato per primo", () => {
    expect(parseQuery('seggiolino auto per neonato').filters.category).toBe('bambini');
    expect(parseQuery('cassettiera bianca').filters.category).toBe('arredamento');
    expect(parseQuery('macchina del caffè Jura').filters.category).toBe('elettrodomestici');
  });
});

describe('formatChf', () => {
  it('usa il formato svizzero', () => {
    expect(formatChf(1450)).toBe("CHF 1'450.–");
    expect(formatChf(3699.9)).toBe("CHF 3'699.90");
    expect(formatChf(0)).toBe('Regalo');
  });
});
