/**
 * Importa un PROPRIO annuncio da tutti.ch, anibis.ch o ricardo.ch: dal link si legge la pagina e se ne fa una bozza.
 * Qui solo funzioni pure (controllo del link, lettura dell'HTML, bozza): il download sta in lib/import-listing.ts.
 *
 * Com'erano fatte le pagine a novembre 2026:
 * - tutti.ch e anibis.ch (stessa piattaforma): JSON-LD schema.org/Product con prezzo e luogo, e in __NEXT_DATA__
 *   l'oggetto `listing` con testo intero, foto, categoria e proprietà. Un annuncio che non c'è più risponde 404.
 * - ricardo.ch: JSON-LD con @graph (Product, BreadcrumbList) e in __NEXT_DATA__ `pageProps.article` con offerta,
 *   descrizione in HTML, foto e indirizzo. `window.isClosedPdp=true` quando l'asta è finita.
 *   Dal server ricardo risponde spesso 403 con una pagina "Ricardo Captcha": allora si incolla il testo.
 * Se i portali cambiano pagina, si ripiega sui meta og: (titolo, descrizione, foto).
 */
import type { Draft } from './draft.ts';
import { draftWithRules, MAX_PHOTOS } from './draft.ts';
import { detectCategory } from './categories.ts';
import { COMUNI, resolveComune } from './comuni.ts';
import { estimatePrice } from './price.ts';
import { sentenceCase, tokenize } from './text.ts';
import type { CategoryId, Comune, Condition } from './types.ts';

export type ImportSite = 'tutti' | 'anibis' | 'ricardo';

export const SITE_NAME: Record<ImportSite, string> = { tutti: 'tutti.ch', anibis: 'anibis.ch', ricardo: 'ricardo.ch' };

/** Gli unici host da cui si legge la pagina dell'annuncio. */
const PAGE_HOSTS: Record<string, ImportSite> = {
  'www.tutti.ch': 'tutti',
  'tutti.ch': 'tutti',
  'www.anibis.ch': 'anibis',
  'anibis.ch': 'anibis',
  'www.ricardo.ch': 'ricardo',
  'ricardo.ch': 'ricardo',
};

/** Gli unici host da cui si scaricano le foto (le loro CDN). */
const PHOTO_HOSTS = new Set(['c.tutti.ch', 'c.anibis.ch', 'img.ricardostatic.ch']);

/** Messaggio per un sito che blocca il nostro server: resta la strada del testo incollato. */
export const BLOCKED = (site: ImportSite) => `${SITE_NAME[site]} non lascia leggere l'annuncio al nostro server. Incolla qui sotto il testo dell'annuncio: la bozza la prepara l'assistente.`;

export type ImportErrorKind = 'link' | 'scaduto' | 'bloccato' | 'pagina';

export class ImportError extends Error {
  kind: ImportErrorKind;
  constructor(kind: ImportErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ImportTarget {
  site: ImportSite;
  /** Indirizzo pulito della pagina in italiano, senza parametri. */
  url: string;
}

/**
 * Controlla il link incollato: solo i tre portali e solo la pagina di un annuncio.
 * Toglie parametri e ancore e chiede la versione italiana (su anibis anche la traduzione del testo).
 */
export function checkImportUrl(raw: string): ImportTarget {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ImportError('link', 'Questo non sembra un link. Copia l\'indirizzo dalla barra del browser, ad esempio https://www.tutti.ch/it/vi/…');
  }
  const site = PAGE_HOSTS[url.hostname.toLowerCase()];
  if (!site && /(^|\.)anubis\.ch$/i.test(url.hostname)) {
    throw new ImportError('link', 'Forse intendevi anibis.ch (con la i)? Si possono importare annunci di tutti.ch, anibis.ch e ricardo.ch.');
  }
  if (!site || url.username || url.password || (url.port && url.port !== '443')) {
    throw new ImportError('link', 'Si possono importare solo annunci di tutti.ch, anibis.ch e ricardo.ch.');
  }
  const host = `www.${site}.ch`;
  if (site === 'ricardo') {
    // /it/a/<titolo>-<numero>/
    const m = url.pathname.match(/^\/(?:de|fr|it|en)\/a\/([^/]*-)?(\d{6,})\/?$/);
    if (!m) throw new ImportError('link', 'Il link non porta a un annuncio di ricardo.ch: apri l\'annuncio e copia l\'indirizzo da lì.');
    return { site, url: `https://${host}/it/a/${m[1] ?? ''}${m[2]}/` };
  }
  // /it/vi/<numero> oppure /it/vi/<regione>/<categoria>/<titolo>/<numero>
  const m = url.pathname.match(/^\/(?:de|fr|it|en)\/vi\/(?:[^/?#]+\/)*(\d{5,})\/?$/);
  if (!m) throw new ImportError('link', `Il link non porta a un annuncio di ${SITE_NAME[site]}: apri l'annuncio e copia l'indirizzo da lì.`);
  return { site, url: `https://${host}/it/vi/${m[1]}` };
}

/** Una foto si scarica solo dalla CDN del portale, in https. */
export function isPhotoUrlAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.port && PHOTO_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Quello che si legge dalla pagina, prima di farne una bozza. */
export interface ImportedListing {
  site: ImportSite;
  title: string;
  description: string;
  priceChf: number | null;
  postcode: string | null;
  city: string | null;
  /** Categoria del portale, dalla più precisa alla più generale ("Tavoli", "Mobili"). */
  categories: string[];
  condition: Condition | null;
  photos: string[];
  /** Il portale ha tradotto il testo in automatico. */
  translated: boolean;
}

// ---------- lettura dell'HTML ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** Da HTML a testo semplice: paragrafi e righe di elenco su righe proprie. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|h\d|ul|ol)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Testo dell'annuncio: niente markdown dei portali (**grassetto**), niente righe vuote di troppo. */
function cleanText(s: string): string {
  return decodeEntities(s)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\*{1,2} /gm, '- ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scripts(html: string, match: RegExp): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) if (match.test(m[1])) out.push(m[2]);
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Il primo oggetto (in profondità) che soddisfa la condizione. */
function findDeep(value: unknown, test: (o: Json) => boolean, depth = 0): Json | null {
  if (depth > 40) return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findDeep(v, test, depth + 1);
      if (found) return found;
    }
  } else if (isObj(value)) {
    if (test(value)) return value;
    for (const v of Object.values(value)) {
      const found = findDeep(v, test, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Il Product schema.org nei blocchi JSON-LD, anche dentro un @graph. */
function jsonLdProduct(html: string): Json | null {
  for (const block of scripts(html, /application\/ld\+json/i)) {
    const found = findDeep(parseJson(block), (o) => o['@type'] === 'Product' && Boolean(o.name));
    if (found) return found;
  }
  return null;
}

function nextData(html: string): unknown {
  const block = scripts(html, /id=["']__NEXT_DATA__["']/i)[0];
  return block ? parseJson(block) : null;
}

/** Valori dei meta og:, in ordine (og:image può comparire più volte). */
function ogMeta(html: string, property: string): string[] {
  const out: string[] = [];
  const re = /<meta\b[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = m[0];
    const prop = tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (prop?.toLowerCase() === property && content != null) out.push(decodeEntities(content));
  }
  return out;
}

const SITE_SUFFIX = /\s*(?:Cantone \S+(?: \S+)?\s*)?\|\s*(?:tutti\.ch|anibis\.ch|Comprare su Ricardo|Acquista su Ricardo).*$/i;

const LD_CONDITION: Record<string, Condition> = {
  NewCondition: 'nuovo',
  UsedCondition: 'buono',
  RefurbishedCondition: 'come_nuovo',
  DamagedCondition: 'da_riparare',
};

/** Condizione scritta dal portale ("Nuovo", "Come nuovo", "Usato", "Difettoso"…). */
export function conditionFromLabel(label: string | null | undefined): Condition | null {
  if (!label) return null;
  const s = label.toLowerCase().replace(/[_-]/g, ' ');
  if (/come nuov|pari al nuovo|like new|wie neu|comme neuf/.test(s)) return 'come_nuovo';
  if (/^(nuov|new|neu|neuf)/.test(s)) return 'nuovo';
  if (/difett|guast|defect|defekt|ricambi|for parts|bastler/.test(s)) return 'da_riparare';
  if (/accettabil|acceptable|segni/.test(s)) return 'usato';
  if (/usat|used|gebraucht|occasion|buon|good/.test(s)) return 'buono';
  return null;
}

/** Toglie i doppioni, anche la stessa foto in due misure (ricardo: /t_1000x750/ e /t_1800x1350/). */
const unique = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((u) => {
    const key = u.replace(/^https?:/, '').replace(/\/t_\d+x\d+\//, '/');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** tutti.ch e anibis.ch: stessa piattaforma, stessa pagina. */
function parseSmg(site: ImportSite, html: string): ImportedListing {
  const product = jsonLdProduct(html);
  const listing = findDeep(nextData(html), (o) => 'listingID' in o && isObj(o.localization));
  const offers = isObj(product?.offers) ? product.offers : null;
  const address = isObj(offers?.seller) && isObj((offers.seller as Json).address) ? ((offers.seller as Json).address as Json) : null;

  const loc = isObj(listing?.localization) ? listing.localization : null;
  const postcodeInfo = isObj(listing?.postcodeInformation) ? listing.postcodeInformation : null;
  const seo = isObj(listing?.seoInformation) ? listing.seoInformation : null;
  const cat = isObj(listing?.primaryCategory) ? listing.primaryCategory : null;
  const props = Array.isArray(listing?.properties) ? (listing.properties as Json[]) : [];
  const conditionProp = props.find((p) => /itemCondition|condition/i.test(String(p.listingPropertyID ?? '')));
  const images = Array.isArray(listing?.images) ? (listing.images as Json[]) : [];

  return {
    site,
    title: str(loc?.title) ?? str(product?.name) ?? str(ogMeta(html, 'og:title')[0]?.replace(SITE_SUFFIX, '')) ?? '',
    description: cleanText(str(loc?.body) ?? str(product?.description) ?? ogMeta(html, 'og:description')[0] ?? ''),
    priceChf: num(seo?.numericPrice) ?? num(offers?.price),
    postcode: str(postcodeInfo?.postcode) ?? str(address?.postalCode),
    city: str(postcodeInfo?.locationName) ?? str(address?.addressLocality),
    categories: [str(cat?.label), isObj(cat?.parent) ? str(cat.parent.label) : null].filter((c): c is string => Boolean(c)),
    condition: conditionFromLabel(str(conditionProp?.text)) ?? (offers ? LD_CONDITION[String(offers.itemCondition ?? '').split('/').pop() ?? ''] ?? null : null),
    photos: unique([
      ...images.map((i) => (isObj(i.rendition) ? str(i.rendition.src) : null)).filter((u): u is string => Boolean(u)),
      ...ogMeta(html, 'og:image:secure_url'),
      ...(typeof product?.image === 'string' ? [product.image] : []),
    ]),
    translated: loc?.translationStatus === 'AUTOMATED',
  };
}

const RICARDO_CONDITION: Record<string, Condition> = {
  new: 'nuovo',
  like_new: 'come_nuovo',
  used: 'buono',
  acceptable: 'usato',
  defective: 'da_riparare',
  for_parts: 'da_riparare',
};

function parseRicardo(html: string): ImportedListing {
  const product = jsonLdProduct(html);
  const data = nextData(html);
  const article = findDeep(data, (o) => isObj(o.offer) && 'title' in o && 'images' in o);
  const offer = isObj(article?.offer) ? article.offer : null;
  const desc = isObj(article?.description) ? article.description : null;
  const category = isObj(article?.category) ? article.category : null;
  const sellerAddress = isObj(article?.seller) && Array.isArray((article.seller as Json).addresses) ? ((article.seller as Json).addresses as Json[])[0] : null;
  const images = Array.isArray(article?.images) ? (article.images as Json[]) : [];
  // Prezzo "compralo subito" se c'è, altrimenti il prezzo di partenza dell'asta (in centesimi)
  const startCents = num(offer?.start_price);
  const buyNow = /buynow|buy_now|fixed/i.test(String(offer?.offer_type ?? '')) ? num(offer?.price) : null;
  const ldImages = Array.isArray(product?.image) ? (product.image as unknown[]) : [product?.image];

  return {
    site: 'ricardo',
    title: str(article?.title) ?? str(product?.name) ?? str(ogMeta(html, 'og:title')[0]?.replace(SITE_SUFFIX, '')) ?? '',
    description: cleanText(desc && str(desc.html) ? htmlToText(String(desc.html)) : (str(product?.description) ?? '')),
    priceChf: buyNow ?? (startCents != null ? startCents / 100 : num(offer?.price)),
    postcode: str(offer?.zip_code) ?? str(sellerAddress?.zip_code),
    city: str(offer?.city) ?? str(sellerAddress?.city),
    categories: [str(category?.name), isObj(category?.parent) ? str(category.parent.name) : null].filter((c): c is string => Boolean(c)),
    condition: RICARDO_CONDITION[String(article?.conditionKey ?? '')] ?? null,
    photos: unique([
      ...images.map((i) => str(i.bigSizeUrl) ?? str(i.url)).filter((u): u is string => Boolean(u)),
      ...ldImages.filter((u): u is string => typeof u === 'string'),
      ...ogMeta(html, 'og:image:secure_url'),
      ...ogMeta(html, 'og:image'),
    ]),
    translated: false,
  };
}

/** Pagina di un sistema anti-bot invece dell'annuncio. */
export function isBlockedPage(html: string): boolean {
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '';
  return /captcha|just a moment|attention required|access denied|zugriff verweigert/i.test(title) || /cf-chl-|challenge-platform|datadome|px-captcha/i.test(html.slice(0, 20_000));
}

/** Annuncio scaduto, venduto o tolto (la pagina c'è ma l'annuncio non è più attivo). */
export function isClosedPage(site: ImportSite, html: string): boolean {
  if (site === 'ricardo') {
    if (/window\.isClosedPdp\s*=\s*true/.test(html)) return true;
    const article = findDeep(nextData(html), (o) => isObj(o.offer) && 'title' in o);
    const status = String(article?.status ?? '');
    return Boolean(status) && status !== 'PUBLISHED';
  }
  const offers = jsonLdProduct(html)?.offers;
  return isObj(offers) && /OutOfStock|SoldOut|Discontinued/i.test(String(offers.availability ?? ''));
}

/** Legge la pagina dell'annuncio. Errore chiaro se è una pagina anti-bot, se l'annuncio è chiuso o se non si capisce. */
export function parseListingPage(site: ImportSite, html: string): ImportedListing {
  if (isBlockedPage(html)) throw new ImportError('bloccato', BLOCKED(site));
  if (isClosedPage(site, html)) throw new ImportError('scaduto', 'Questo annuncio è scaduto o già venduto: importa un annuncio ancora online.');
  const listing = site === 'ricardo' ? parseRicardo(html) : parseSmg(site, html);
  listing.title = listing.title.replace(SITE_SUFFIX, '').trim();
  listing.photos = listing.photos.filter(isPhotoUrlAllowed).slice(0, MAX_PHOTOS);
  if (!listing.title) throw new ImportError('pagina', `Non riesco a leggere questo annuncio di ${SITE_NAME[site]}. Prova a incollare il testo.`);
  return listing;
}

// ---------- dalla pagina alla bozza ----------

/** Il comune di ritiro: prima dal CAP, poi dal nome. Solo comuni del Ticino. */
export function comuneFor(postcode: string | null, city: string | null): Comune | null {
  if (city) {
    const byName = resolveComune(city);
    if (byName) return byName;
  }
  if (postcode) {
    const byCap = COMUNI.find((c) => c.cap === postcode);
    if (byCap) return byCap;
  }
  return null;
}

/** La categoria di giro.shop più vicina: prima quella del portale, poi titolo e testo. */
export function categoryFor(listing: Pick<ImportedListing, 'categories' | 'title' | 'description'>): CategoryId {
  for (const text of [...listing.categories, listing.title, listing.description.slice(0, 600)]) {
    const found = detectCategory(tokenize(text));
    if (found) return found.id;
  }
  return 'altro';
}

/** La bozza di Vendi, come se l'avesse preparata l'assistente: chi vende la controlla e pubblica. */
export function draftFromImport(listing: ImportedListing): { draft: Draft; priceChf: number | null } {
  const rules = draftWithRules(`${listing.title}. ${listing.description}`);
  const category = categoryFor(listing);
  const condition = listing.condition ?? rules.condition;
  const comune = comuneFor(listing.postcode, listing.city);
  const warnings: string[] = [];
  if (!comune && (listing.city || listing.postcode)) {
    warnings.push(`L'annuncio era a ${[listing.postcode, listing.city].filter(Boolean).join(' ')}: scegli il comune di ritiro in Ticino.`);
  }
  if (listing.translated) warnings.push(`Il testo è stato tradotto in automatico da ${SITE_NAME[listing.site]}: rileggilo.`);
  if (listing.priceChf == null) warnings.push('Il prezzo non era indicato: scrivilo tu.');
  const questions: string[] = [];
  if (!listing.condition) questions.push('In che stato è? Controlla la condizione.');

  const title = sentenceCase(listing.title.replace(/\s+/g, ' ').replace(/!{2,}/g, '').trim()).slice(0, 80);
  const draft: Draft = {
    id: `b-${crypto.randomUUID().slice(0, 8)}`,
    object: listing.categories[0] ?? rules.object,
    title,
    description: listing.description.slice(0, 4000),
    category,
    tags: rules.tags,
    attributes: [],
    condition,
    conditionNote: null,
    confidence: 1,
    questions,
    comune,
    price: estimatePrice({ text: [title, rules.tags.join(' ')].join(' '), category, condition }),
    source: 'regole',
    model: null,
    warnings,
    importedFrom: SITE_NAME[listing.site],
    createdAt: new Date().toISOString(),
  };
  return { draft, priceChf: listing.priceChf != null ? Math.round(listing.priceChf) : null };
}
