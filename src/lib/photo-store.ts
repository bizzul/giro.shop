import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Foto degli annunci nello Storage (bucket «foto»): la foto intera e, accanto, la miniatura per le schede degli elenchi.
 * <cartella>/<nome>.jpg → <cartella>/<nome>-sm.webp, larga 480 px come le versioni piccole delle foto di prova.
 * Senza miniatura (un'immagine che sharp non legge, un caricamento non riuscito) l'annuncio resta valido
 * e le pagine usano la foto intera.
 */

/** Larghezza della miniatura: nelle schede la foto è larga al massimo 360 px, sul telefono metà schermo. */
export const SMALL_WIDTH = 480;

export interface Thumbnail {
  bytes: Buffer;
  /** Dimensioni della foto intera, già girata secondo l'EXIF. */
  width: number;
  height: number;
}

/** Miniatura WebP larga 480 px (mai ingrandita), girata secondo l'EXIF e senza metadati (niente posizione GPS). */
export async function makeThumbnail(input: Uint8Array | ArrayBuffer): Promise<Thumbnail> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const meta = await sharp(bytes, { failOn: 'none' }).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 0;
  const height = (turned ? meta.width : meta.height) ?? 0;
  const small = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize({ width: SMALL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
  return { bytes: small, width, height };
}

export const smallPathFor = (path: string) => `${path.replace(/\.[^./]+$/, '')}-sm.webp`;

/** Riga di listing_photos per una foto salvata: percorso, miniatura (se c'è) e dimensioni (se lette). */
export interface StoredPhoto {
  storage_path: string;
  small_path: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Carica la foto e la sua miniatura con il client dato (quello della persona, o quello del server per MCP).
 * Errore solo se non si carica la foto intera: la miniatura è un di più.
 */
export async function storePhoto(
  client: SupabaseClient,
  path: string,
  body: Blob | Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<{ error: string; photo?: never } | { error: null; photo: StoredPhoto }> {
  const { error } = await client.storage.from('foto').upload(path, body, { contentType });
  if (error) return { error: error.message };
  const photo: StoredPhoto = { storage_path: path, small_path: null, width: null, height: null };
  try {
    const thumb = await makeThumbnail(body instanceof Blob ? await body.arrayBuffer() : body);
    photo.width = thumb.width || null;
    photo.height = thumb.height || null;
    const small = smallPathFor(path);
    const { error: smallError } = await client.storage.from('foto').upload(small, thumb.bytes, { contentType: 'image/webp' });
    if (smallError) console.warn(`[giro] miniatura di ${path} non caricata: ${smallError.message}`);
    else photo.small_path = small;
  } catch (error) {
    console.warn(`[giro] miniatura di ${path} non creata: ${(error as Error).message}`);
  }
  return { error: null, photo };
}
