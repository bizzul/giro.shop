/** Foto lato browser: riduzione prima dell'invio, così il caricamento è veloce e resta sotto i limiti. */
import { gpsFromJpeg, type GpsPoint } from '../core/exif.ts';

export const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1568;

/** I metadati EXIF stanno all'inizio del file: basta leggere questa parte. */
const EXIF_WINDOW = 512 * 1024;

/** Dove è stata scattata la foto (EXIF dei JPEG), letto dal file originale prima di ridurlo. */
export async function photoGps(file: File): Promise<GpsPoint | null> {
  if (file.type !== 'image/jpeg' && !/\.jpe?g$/i.test(file.name)) return null;
  try {
    return gpsFromJpeg(new Uint8Array(await file.slice(0, EXIF_WINDOW).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Riduce il lato lungo a 1568 px in JPEG; se il formato non è leggibile (es. HEIC) restituisce il file com'è.
 * Con stripMetadata la foto si ridisegna sempre, anche se è già piccola: così la posizione GPS (e gli altri
 * metadati) non finisce nella foto pubblica dell'annuncio.
 */
export async function shrinkImage(file: File, { stripMetadata = false } = {}): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (!stripMetadata && scale === 1 && file.size < 1_500_000 && ACCEPTED_IMAGES.includes(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('conversione non riuscita'))), 'image/jpeg', 0.85),
    );
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
