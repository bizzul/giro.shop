import { beforeAll, describe, expect, it } from 'vitest';
import { configureStore, getListing, photoUrl, rowToListing, usingDatabase } from '../src/core/store.ts';

describe('store senza Supabase', () => {
  it('usa i dati di prova con le foto di esempio', () => {
    expect(usingDatabase()).toBe(false);
    const l = getListing('l-031');
    expect(l?.title).toMatch(/Vespa PX/);
    expect(l?.photos?.[0]?.src).toBe('/foto/l-031.webp');
    expect(l?.photos?.[0]?.credit?.license).toBe('CC0');
  });
});

describe('righe di Supabase', () => {
  beforeAll(() => configureStore('http://127.0.0.1:54321', 'chiave-di-prova'));

  it('converte una riga con foto caricata e foto di esempio', () => {
    const l = rowToListing({
      id: 'abc',
      title: 'Lampada in ottone',
      description: '',
      category_id: 'arredamento',
      tags: ['lampada'],
      attributes: {},
      price_chf: '45.00',
      negotiable: false,
      condition: 'buono',
      comune_id: 'lugano',
      status: 'in_trattativa',
      published_at: null,
      created_at: '2026-11-06T10:00:00Z',
      sold_price_chf: null,
      seller_id: 'u1',
      seller: { display_name: 'Marta', phone_verified_at: '2026-11-01T00:00:00Z' },
      photos: [
        { storage_path: 'u1/abc/1.jpg', position: 1, credit: null, width: null, height: null },
        { storage_path: '/foto/l-001.webp', position: 0, credit: null, width: 1024, height: 768 },
      ],
    });
    expect(l.priceChf).toBe(45);
    expect(l.status).toBe('pubblicato');
    expect(l.publishedAt).toBe('2026-11-06T10:00:00Z');
    expect(l.seller).toEqual({ name: 'Marta', verified: true });
    expect(l.photos?.[0].src).toBe('/foto/l-001.webp');
    expect(l.photos?.[0].srcSmall).toBe('/foto/l-001-sm.webp');
    expect(l.photos?.[1].src).toBe('http://127.0.0.1:54321/storage/v1/object/public/foto/u1/abc/1.jpg');
  });

  it('lascia invariati i percorsi del sito', () => {
    expect(photoUrl('/foto/l-002.webp')).toBe('/foto/l-002.webp');
  });
});
