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

describe('chip che si possono togliere', () => {
  const without = (q: string) => Object.fromEntries(parseQuery(q).chips.map((c) => [c.key, c.without]));

  it('toglie un filtro lasciando il resto della frase com’era', () => {
    const w = without('Scrivania in legno sotto i 150 franchi vicino a Lugano');
    expect(w.Prezzo).toBe('Scrivania in legno vicino a Lugano');
    expect(w.Zona).toBe('Scrivania in legno sotto i 150 franchi');
    expect(w.Materiale).toBe('Scrivania sotto i 150 franchi vicino a Lugano');
    // L'oggetto cercato non si toglie
    expect(w.Categoria).toBeUndefined();
  });

  it('toglie età, ritiro e luogo senza lasciare virgole orfane', () => {
    const w = without('bici per una bimba di 6 anni, ritiro a Bellinzona');
    expect(w.Ruote).toBe('bici per una bimba, ritiro a Bellinzona');
    expect(w.Zona).toBe('bici per una bimba di 6 anni, ritiro');
    expect(w.Consegna).toBe('bici per una bimba di 6 anni, a Bellinzona');
  });

  it('riconosce i pezzi anche con apostrofi e numeri svizzeri', () => {
    const w = without("Vespa anni '80 anche da sistemare, massimo 2'000");
    expect(w.Anno).toBe('Vespa anche da sistemare, massimo 2\'000');
    expect(w.Stato).toBe("Vespa anni '80, massimo 2'000");
    expect(w.Prezzo).toBe("Vespa anni '80 anche da sistemare");
  });

  it('toglie insieme il raggio e il luogo', () => {
    expect(without('sci entro 20 km da Airolo').Zona).toBe('sci');
    expect(without('sotto 150 franchi').Prezzo).toBe('');
  });
});
