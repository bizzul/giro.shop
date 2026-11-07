import { describe, expect, it } from 'vitest';
import { breadcrumbJsonLd, jsonLdScript, listingJsonLd, robotsTxt, siteJsonLd, sitemapXml } from '../src/core/seo.ts';
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
    expect(offer.url).toMatch(/^https:\/\/giro\.shop\/annuncio\/l-001-[a-z0-9-]+$/);
    expect(offer.itemCondition).toMatch(/schema\.org\/(Used|New|Damaged)Condition/);
    expect(offer.availableAtOrFrom.address.addressCountry).toBe('CH');
    expect(offer.shippingDetails.shippingRate.value).toBe('9.00');
    expect((ld.image as string[]).every((src) => src.startsWith('https://'))).toBe(true);
  });

  it('segna venduto e in trattativa', () => {
    expect((listingJsonLd({ ...listing, status: 'venduto' }, 'https://x').offers as any).availability).toBe('https://schema.org/SoldOut');
    expect((listingJsonLd({ ...listing, negotiating: true }, 'https://x').offers as any).availability).toBe('https://schema.org/LimitedAvailability');
  });

  it('home: Organization e WebSite con la ricerca a frasi', () => {
    const graph = siteJsonLd('https://giro.shop')['@graph'] as Array<Record<string, any>>;
    const org = graph.find((n) => n['@type'] === 'Organization')!;
    const site = graph.find((n) => n['@type'] === 'WebSite')!;
    expect(org.name).toBe('giro.shop');
    expect(org.logo).toBe('https://giro.shop/favicon.svg');
    expect(site.publisher['@id']).toBe(org['@id']);
    expect(site.potentialAction.target.urlTemplate).toBe('https://giro.shop/cerca?q={search_term_string}');
    expect(site.potentialAction['query-input']).toBe('required name=search_term_string');
  });

  it('percorso della scheda: posizioni in ordine e indirizzi completi', () => {
    const crumbs = breadcrumbJsonLd('https://giro.shop', [
      { name: 'Annunci', path: '/cerca' },
      { name: listing.title, path: '/annuncio/l-001' },
    ]);
    expect(crumbs['@type']).toBe('BreadcrumbList');
    expect(crumbs.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Annunci', item: 'https://giro.shop/cerca' },
      { '@type': 'ListItem', position: 2, name: listing.title, item: 'https://giro.shop/annuncio/l-001' },
    ]);
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

describe('indirizzi con il titolo e pagine /usato', () => {
  it('il titolo diventa parte dell\'indirizzo, il codice si ritrova sempre', async () => {
    const { slugify, listingPath, listingIdFromParam } = await import('../src/core/seo.ts');
    expect(slugify('Scrivania bianca laccata 140×70')).toBe('scrivania-bianca-laccata-140-70');
    expect(slugify('Città: più è già!')).toBe('citta-piu-e-gia');
    expect(listingPath({ id: 'l-004', title: 'Scrivania bianca' })).toBe('/annuncio/l-004-scrivania-bianca');
    const uuid = 'f032595a-f4c1-481f-bb5f-cfd089fd4527';
    expect(listingIdFromParam(`${uuid}-moto-harley`)).toBe(uuid);
    expect(listingIdFromParam(uuid)).toBe(uuid);
    expect(listingIdFromParam('l-004-scrivania-bianca')).toBe('l-004');
    expect(listingIdFromParam('l-004')).toBe('l-004');
  });

  it('oggetti dalle parole della ricerca a frasi, pagine per oggetto e comune', async () => {
    const { getOggetto } = await import('../src/core/seo.ts');
    const { usatoPage, usatoSitemap } = await import('../src/lib/usato.ts');
    expect(getOggetto('divani')?.label).toBe('Divani');
    expect(usatoPage('divani', 'lugano')).toMatchObject({ query: 'Divani a Lugano', path: '/usato/divani/lugano' });
    expect(usatoPage('divani')?.query).toBe('Divani');
    expect(usatoPage('non-esiste')).toBeNull();
    expect(usatoPage('divani', 'zurigo')).toBeNull();
    const paths = usatoSitemap();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => /^\/usato\/[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(p))).toBe(true);
  });
});
