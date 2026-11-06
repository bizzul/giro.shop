import { describe, expect, it } from 'vitest';
import { suggestTags, tagKey } from '../src/core/tags.ts';
import { publishedListings } from '../src/core/store.ts';

const listings = publishedListings();

describe('suggestTags', () => {
  it("propone le parole chiave degli annunci simili, prima quelle che il testo nomina", () => {
    const tags = suggestTags(
      { title: 'Scrivania in rovere', description: 'Piano in legno, due cassetti.', category: 'arredamento', tags: [] },
      listings,
    );
    expect(tags[0]).toBe('scrivania');
    expect(tags).toContain('rovere');
    expect(tags).toContain('legno');
    expect(tags).toContain('cassetti');
  });

  it('non ripropone le parole che ha già, nemmeno al plurale', () => {
    const tags = suggestTags({ title: 'Scrivania in rovere', category: 'arredamento', tags: ['Scrivanie', 'rovere'] }, listings);
    expect(tags).not.toContain('scrivania');
    expect(tags).not.toContain('scrivanie');
    expect(tags).not.toContain('rovere');
  });

  it("riconosce l'oggetto dalle parole della categoria e tiene marche e accenti del titolo", () => {
    const tags = suggestTags({ title: 'Divano Ikea Söderhamn 120×60', category: 'arredamento', tags: [] }, listings);
    expect(tags[0]).toBe('divano');
    expect(tags).toContain('ikea');
    expect(tags).toContain('söderhamn');
    expect(tags).not.toContain('120×60');
  });

  it("non conta l'annuncio stesso e resta nel limite", () => {
    const own = listings.find((l) => l.id === 'l-001')!;
    const tags = suggestTags({ ...own, tags: [] }, listings, 5);
    expect(tags.length).toBeLessThanOrEqual(5);
    expect(tags.map(tagKey)).not.toContain(tagKey('ufficio'));
  });
});

describe('suggestTags, oggetto e decennio', () => {
  it("guarda l'oggetto del titolo e il decennio, non gli altri decenni", () => {
    const tags = suggestTags(
      { title: 'Lampada da scrivania in ottone, anni 70', category: 'arredamento', tags: ['lampada', 'scrivania', 'ottone'] },
      listings,
    );
    expect(tags[0]).toBe('anni 70');
    expect(tags).not.toContain('anni 60');
  });
});
