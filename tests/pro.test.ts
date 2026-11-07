import { describe, expect, it } from 'vitest';
import { bulkPrice, parseBulk } from '../src/core/bulk.ts';
import { parseCatalog, parsePrice } from '../src/core/catalog.ts';
import { protectedFee } from '../src/core/pricing.ts';

const now = new Date('2026-11-12T09:00:00Z'); // giovedì

describe('modifiche in blocco a parole', () => {
  it('sconto fino a domenica, solo gli sci', () => {
    expect(parseBulk('Tutti gli sci −20% fino a domenica', now)).toEqual({ pct: -20, endsAt: '2026-11-15T22:59:59.000Z', query: 'sci' });
  });

  it('aumento, per sempre, su tutto', () => {
    expect(parseBulk('aumenta del 5% tutti gli annunci', now)).toEqual({ pct: 5, endsAt: null, query: '' });
    expect(parseBulk('+5% su tutto', now)).toEqual({ pct: 5, endsAt: null, query: '' });
  });

  it('per qualche giorno o fino a una data', () => {
    expect(parseBulk('biciclette -10% per 3 giorni', now)).toMatchObject({ pct: -10, endsAt: '2026-11-14T22:59:59.000Z', query: 'biciclette' });
    expect(parseBulk('sconto del 15% fino al 30 novembre', now)).toMatchObject({ pct: -15, endsAt: '2026-11-30T22:59:59.000Z', query: '' });
  });

  it('senza percentuale non si fa niente', () => {
    expect(parseBulk('sci in saldo', now)).toHaveProperty('error');
  });

  it('prezzi arrotondati, mai sotto un franco', () => {
    expect(bulkPrice(129, -20)).toBe(103);
    expect(bulkPrice(12.5, -20)).toBe(10);
    expect(bulkPrice(1, -50)).toBe(1);
  });
});

describe('import del catalogo', () => {
  it('riconosce colonne, separatore, categoria, condizione e prezzo', () => {
    const csv = [
      'Titolo;Descrizione;Categoria;Condizione;Prezzo;Comune;Foto',
      '"Sci Atomic Redster, 170 cm";Usati una stagione;;come nuovo;"CHF 1\'200.–";Lugano;https://esempio.test/a.jpg http://insicuro.test/b.jpg',
      'Vespa PX 125;;Moto e scooter;usato;2400;;',
      'X;;;;abc;Atlantide;',
    ].join('\n');
    const { rows, error } = parseCatalog(csv, 'Bellinzona');
    expect(error).toBeUndefined();
    expect(rows[0]).toMatchObject({ line: 2, title: 'Sci Atomic Redster, 170 cm', category: 'sport_inverno', condition: 'come_nuovo', priceChf: 1200, comuneId: 'lugano', photos: ['https://esempio.test/a.jpg'], errors: [] });
    expect(rows[1]).toMatchObject({ category: 'moto_scooter', condition: 'usato', priceChf: 2400, comuneId: 'bellinzona', errors: [] });
    expect(rows[2].errors).toEqual(['titolo troppo corto', 'prezzo non valido', 'comune «Atlantide» sconosciuto']);
  });

  it('senza titolo o prezzo non si importa', () => {
    expect(parseCatalog('nome,colore\nsedia,rossa').error).toContain('titolo');
  });

  it('prezzi scritti in tanti modi', () => {
    expect(parsePrice("1'200.–")).toBe(1200);
    expect(parsePrice('1.200,50')).toBe(1200.5);
    expect(parsePrice('Fr. 45')).toBe(45);
    expect(parsePrice('gratis')).toBeNull();
  });
});

describe('commissione del pagamento protetto', () => {
  it('5% più 50 centesimi, ai 5 centesimi, al massimo 30 franchi', () => {
    expect(protectedFee(100)).toBe(5.5);
    expect(protectedFee(37)).toBe(2.35);
    expect(protectedFee(2000)).toBe(30);
  });
});
