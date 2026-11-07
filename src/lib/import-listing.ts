/**
 * Importa un annuncio da tutti.ch, anibis.ch o ricardo.ch: scarica la pagina e le foto, poi ne fa la bozza di Vendi.
 * Regole, per rispetto dei portali e per sicurezza:
 * - solo su richiesta di chi vende, un link alla volta, niente crawling (e un limite di richieste per persona);
 * - User-Agent del sito, senza email; si legge una sola pagina, come farebbe un browser;
 * - solo gli host dei portali (pagina) e delle loro CDN (foto): ogni redirect viene ricontrollato;
 * - pagina al massimo 4 MB, foto al massimo 5 e 5 MB l'una, 10 secondi per richiesta;
 * - le foto vengono ridisegnate senza metadati (niente EXIF, niente posizione).
 */
import sharp from 'sharp';
import { BLOCKED, checkImportUrl, draftFromImport, ImportError, isPhotoUrlAllowed, parseListingPage, SITE_NAME } from '../core/import-listing.ts';
import type { ImportSite } from '../core/import-listing.ts';
import type { Draft } from '../core/draft.ts';
import { MAX_LISTING_PHOTOS } from '../core/photos.ts';
import { fetchImage, ImageFetchError } from './fetch-image.ts';

const USER_AGENT = 'Mozilla/5.0 (compatible; giro.shop/1.0; importa un annuncio su richiesta di chi lo ha scritto)';
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** Lato lungo massimo delle foto importate: come quelle ridotte nel browser da Vendi. */
const PHOTO_SIDE = 1600;

export interface ImportedPhoto {
  type: 'image/jpeg';
  /** Foto in base64, già senza metadati. */
  data: string;
}

export interface ImportResult {
  site: ImportSite;
  url: string;
  draft: Draft;
  priceChf: number | null;
  photos: ImportedPhoto[];
}

async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_PAGE_BYTES) throw new ImportError('pagina', 'La pagina dell\'annuncio è troppo grande.');
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new ImportError('pagina', 'La pagina dell\'annuncio è troppo grande.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Scarica la pagina dell'annuncio; i redirect sono ammessi solo verso lo stesso portale. */
export async function fetchListingPage(site: ImportSite, url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'it-CH,it;q=0.9' },
      });
    } catch {
      throw new ImportError('pagina', `${SITE_NAME[site]} non risponde. Riprova tra poco.`);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      // Un annuncio tolto spesso rimanda alla ricerca: non è più una pagina di annuncio
      let next;
      try {
        next = checkImportUrl(new URL(location, current).href);
      } catch {
        throw new ImportError('scaduto', 'Questo annuncio non è più online: forse è scaduto o è stato tolto.');
      }
      if (next.site !== site) throw new ImportError('link', 'Il link porta a un altro sito.');
      current = next.url;
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      throw new ImportError('scaduto', 'Questo annuncio non è più online: forse è scaduto o è stato tolto.');
    }
    const html = await readLimited(res);
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      throw new ImportError('bloccato', BLOCKED(site));
    }
    if (res.status !== 200) throw new ImportError('pagina', `${SITE_NAME[site]} ha risposto con un errore (${res.status}). Riprova tra poco.`);
    return html;
  }
  throw new ImportError('pagina', 'Troppi rimandi da una pagina all\'altra.');
}

/** Scarica una foto dalla CDN del portale e la ridisegna in JPEG senza metadati. */
async function importPhoto(url: string): Promise<ImportedPhoto> {
  if (!isPhotoUrlAllowed(url)) throw new ImageFetchError('foto fuori dal portale');
  const image = await fetchImage(url);
  // fetchImage blocca già indirizzi interni, file troppo grandi e formati sconosciuti.
  // sharp senza withMetadata() non copia EXIF né posizione GPS
  const bytes = await sharp(image.bytes, { failOn: 'none' })
    .rotate()
    .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { type: 'image/jpeg', data: bytes.toString('base64') };
}

/** Dal link alla bozza con le foto. Gli errori sono ImportError con un messaggio da mostrare così com'è. */
export async function importListing(raw: string): Promise<ImportResult> {
  const target = checkImportUrl(raw);
  const html = await fetchListingPage(target.site, target.url);
  const listing = parseListingPage(target.site, html);
  const { draft, priceChf } = draftFromImport(listing);

  const photos: ImportedPhoto[] = [];
  let failed = 0;
  for (const url of listing.photos.slice(0, MAX_LISTING_PHOTOS)) {
    try {
      photos.push(await importPhoto(url));
    } catch {
      failed++;
    }
  }
  if (failed) draft.warnings.push(failed === 1 ? 'Una foto non si è scaricata: aggiungila tu, se serve.' : `${failed} foto non si sono scaricate: aggiungile tu, se servono.`);
  if (!photos.length) draft.warnings.push("Nessuna foto importata: aggiungine almeno una, la prima è la copertina.");
  return { site: target.site, url: target.url, draft, priceChf, photos };
}
