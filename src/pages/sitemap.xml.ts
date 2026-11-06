/** Sitemap per i motori di ricerca: pagine pubbliche, annunci in vendita e profili di chi vende. */
import type { APIRoute } from 'astro';
import { sitemapXml, type SitemapEntry } from '../core/seo.ts';
import { publishedListings } from '../core/store.ts';
import { siteOrigin } from '../lib/notify.ts';

export const GET: APIRoute = ({ url }) => {
  const listings = publishedListings();
  const latest = listings.map((l) => l.publishedAt).sort().at(-1);
  const sellers = new Map<string, string>();
  for (const l of listings) {
    if (l.sellerId && (!sellers.has(l.sellerId) || l.publishedAt > sellers.get(l.sellerId)!)) sellers.set(l.sellerId, l.publishedAt);
  }
  const entries: SitemapEntry[] = [
    { path: '/', lastmod: latest, priority: 1 },
    { path: '/cerca', lastmod: latest, priority: 0.8 },
    { path: '/sicurezza', priority: 0.4 },
    { path: '/connetti', priority: 0.3 },
    { path: '/privacy', priority: 0.2 },
    { path: '/condizioni', priority: 0.2 },
    ...listings.map((l) => ({ path: `/annuncio/${l.id}`, lastmod: l.publishedAt, priority: 0.7 })),
    ...[...sellers].map(([id, lastmod]) => ({ path: `/venditore/${id}`, lastmod, priority: 0.4 })),
  ];
  return new Response(sitemapXml(siteOrigin(url.origin), entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
