import type { Comune, Listing } from './types.ts';
import { CATEGORIES, getCategory } from './categories.ts';

/**
 * Per i motori di ricerca: dati strutturati schema.org degli annunci, sitemap e robots.txt.
 */

const CONDITION: Record<Listing['condition'], string> = {
  nuovo: 'https://schema.org/NewCondition',
  come_nuovo: 'https://schema.org/UsedCondition',
  buono: 'https://schema.org/UsedCondition',
  usato: 'https://schema.org/UsedCondition',
  da_riparare: 'https://schema.org/DamagedCondition',
};

const absolute = (origin: string, src: string) => (src.startsWith('http') ? src : `${origin}${src}`);

/** Testo da indirizzo: minuscole, senza accenti, parole unite da trattini, al massimo 60 caratteri. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** Indirizzo di un annuncio con il titolo, per le persone e per Google: /annuncio/<codice>-<titolo>. */
export function listingPath(listing: Pick<Listing, 'id' | 'title'>): string {
  const slug = slugify(listing.title);
  return `/annuncio/${listing.id}${slug ? `-${slug}` : ''}`;
}

const LISTING_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|l-\d+)(?:-|$)/i;

/** Il codice dell'annuncio dentro l'indirizzo, con o senza titolo. */
export function listingIdFromParam(param: string): string {
  return param.match(LISTING_ID)?.[1] ?? param;
}

/** Gli oggetti per le pagine /usato/<oggetto>: le etichette che la ricerca a frasi già riconosce (Divani, Scrivanie…). */
export interface Oggetto {
  slug: string;
  label: string;
}
export const OGGETTI: Oggetto[] = [
  ...new Map(CATEGORIES.flatMap((c) => c.keywords.map(([, label]) => [slugify(label), { slug: slugify(label), label }] as const))).values(),
];
export const getOggetto = (slug: string) => OGGETTI.find((o) => o.slug === slug);

/** Un annuncio come Product con la sua Offer: prezzo in CHF, stato, disponibilità, luogo di ritiro. */
export function listingJsonLd(listing: Listing, origin: string, comune?: Comune): Record<string, unknown> {
  const availability =
    listing.status === 'venduto'
      ? 'https://schema.org/SoldOut'
      : listing.negotiating
        ? 'https://schema.org/LimitedAvailability'
        : 'https://schema.org/InStock';
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    url: `${origin}${listingPath(listing)}`,
    priceCurrency: 'CHF',
    price: listing.priceChf.toFixed(2),
    availability,
    itemCondition: CONDITION[listing.condition],
    seller: { '@type': 'Person', name: listing.seller.name },
  };
  if (comune) {
    offer.availableAtOrFrom = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: comune.name, postalCode: comune.cap, addressRegion: 'TI', addressCountry: 'CH' },
    };
  }
  if (listing.shipping && listing.shippingChf != null) {
    offer.shippingDetails = {
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: listing.shippingChf.toFixed(2), currency: 'CHF' },
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'CH' },
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description.slice(0, 5000),
    category: getCategory(listing.category).name,
    image: (listing.photos ?? []).map((p) => absolute(origin, p.src)),
    offers: offer,
  };
}

/**
 * Chi siamo per i motori di ricerca, nella home: Organization (nome, logo, zona) e WebSite (nome del sito nei
 * risultati e indirizzo della ricerca a frasi, per chi sa usarlo).
 */
export function siteJsonLd(origin: string): Record<string, unknown> {
  const org = `${origin}/#organizzazione`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: 'giro.shop',
        url: `${origin}/`,
        logo: `${origin}/favicon.svg`,
        description: "Il mercatino dell'usato tra privati in Ticino.",
        areaServed: { '@type': 'AdministrativeArea', name: 'Canton Ticino' },
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#sito`,
        name: 'giro.shop',
        url: `${origin}/`,
        inLanguage: 'it-CH',
        publisher: { '@id': org },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${origin}/cerca?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };
}

/** Il percorso fino alla pagina (BreadcrumbList): ogni passo tranne l'ultimo ha il suo indirizzo. */
export function breadcrumbJsonLd(origin: string, steps: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: `${origin}${step.path}`,
    })),
  };
}

/** JSON da mettere dentro <script type="application/ld+json">, senza poter chiudere lo script. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export interface SitemapEntry {
  path: string;
  lastmod?: string;
  priority?: number;
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${xml(origin + e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ''}${
          e.priority != null ? `<priority>${e.priority.toFixed(1)}</priority>` : ''
        }</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Pagine private o di servizio: non servono ai motori di ricerca. */
export const PRIVATE_PATHS = [
  '/miei-annunci',
  '/messaggi',
  '/avvisi',
  '/salvati',
  '/moderazione',
  '/segnala',
  '/contesta',
  '/valuta',
  '/domande',
  '/account',
  '/accedi',
  '/auth',
  '/email-avvisi',
  '/risultati',
  '/suggerimenti',
  '/traduci',
  '/cerca-foto',
  '/confronta',
  '/mcp',
  '/_server-islands',
  '/_actions',
];

export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    // Le ricerche con parametri sono infinite e simili tra loro: basta /cerca
    'Disallow: /*?',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}
