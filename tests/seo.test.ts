import { describe, expect, it } from 'vitest';
import { jsonLdScript, listingJsonLd, robotsTxt, sitemapXml } from '../src/core/seo.ts';
import { getListing } from '../src/core/store.ts';
import { getComune } from '../src/core/comuni.ts';

describe('dati per i motori di ricerca', () => {
  const listing = getListing('l-001')!;
  const ld = listingJsonLd({ ...listing, shipping: true, shippingChf: 9 }, 'https://giro.shop', getComune(listing.comuneId));
  const offer = ld.offers as Record<string, any>;

  it('descrive un annuncio come Product con prezzo in CHF, stato e luogo', () => {
    expect(ld['@type']).toBe('Product');
    expect(offer.priceCurrency).toBe('CHF');
    expect(offer.price).toBe(listing.priceChf.toFixed(2));
    expect(offer.url).toBe('https://giro.shop/annuncio/l-001');
    expect(offer.itemCondition).toMatch(/schema\.org\/(Used|New|Damaged)Condition/);
    expect(offer.availableAtOrFrom.address.addressCountry).toBe('CH');
    expect(offer.shippingDetails.shippingRate.value).toBe('9.00');
    expect((ld.image as string[]).every((src) => src.startsWith('https://'))).toBe(true);
  });

  it('segna venduto e in trattativa', () => {
    expect((listingJsonLd({ ...listing, status: 'venduto' }, 'https://x').offers as any).availability).toBe('https://schema.org/SoldOut');
    expect((listingJsonLd({ ...listing, negotiating: true }, 'https://x').offers as any).availability).toBe('https://schema.org/LimitedAvailability');
  });

  it('non lascia chiudere lo script con un titolo malevolo', () => {
    expect(jsonLdScript({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });

  it('sitemap e robots', () => {
    const xml = sitemapXml('https://giro.shop', [{ path: '/annuncio/a&b', lastmod: '2026-11-06T10:00:00Z', priority: 0.7 }]);
    expect(xml).toContain('<loc>https://giro.shop/annuncio/a&amp;b</loc>');
    expect(xml).toContain('<lastmod>2026-11-06</lastmod>');
    const robots = robotsTxt('https://giro.shop');
    expect(robots).toContain('Disallow: /messaggi');
    expect(robots).toContain('Sitemap: https://giro.shop/sitemap.xml');
  });
});
