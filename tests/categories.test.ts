import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/core/query.ts';
import { priceText } from '../src/core/format.ts';
import { CATEGORIES } from '../src/core/categories.ts';
import { CATEGORY_IDS } from '../src/core/types.ts';

const category = (text: string) => parseQuery(text).filters.category ?? null;

describe('categorie di MercatinoTicino', () => {
  it('ci sono tutte, con nome e icona', () => {
    for (const id of ['immobili', 'lavoro', 'servizi', 'animali', 'libri', 'sport', 'eventi', 'viaggi', 'salute', 'gastronomia', 'affari']) {
      expect(CATEGORY_IDS).toContain(id);
      expect(CATEGORIES.find((c) => c.id === id)?.name).toBeTruthy();
    }
  });

  it('la ricerca a frasi le riconosce', () => {
    expect(category('cerco lavoro part time a Lugano')).toBe('lavoro');
    expect(category('villetta a Bellinzona sotto 900000 franchi')).toBe('immobili');
    expect(category('lezioni di chitarra')).toBe('servizi');
    expect(category('cucciolo di labrador')).toBe('animali');
    expect(category('biglietti concerto')).toBe('eventi');
    expect(category('valigia trolley')).toBe('viaggi');
    expect(category('fumetti Tex')).toBe('libri');
    expect(category('cyclette usata')).toBe('sport');
    expect(category('merlot del Ticino')).toBe('gastronomia');
    expect(category('profumo nuovo')).toBe('salute');
  });

  it('non scattano sugli oggetti che ci somigliano', () => {
    expect(category('cavalletto fotografico')).not.toBe('animali');
    expect(category('scatoloni da trasloco')).not.toBe('servizi');
    expect(category('tavolo da lavoro')).toBe('arredamento');
  });

  it('lavoro e servizi a 0: da concordare, non regalo', () => {
    expect(priceText({ priceChf: 0, category: 'lavoro' })).toBe('Da concordare');
    expect(priceText({ priceChf: 0, category: 'arredamento' })).toBe('Regalo');
  });
});
