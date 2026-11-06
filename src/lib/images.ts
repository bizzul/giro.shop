/** Foto lato browser: riduzione prima dell'invio, così il caricamento è veloce e resta sotto i limiti. */

export const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1568;

/** Riduce il lato lungo a 1568 px in JPEG; se il formato non è leggibile (es. HEIC) restituisce il file com'è. */
export async function shrinkImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && ACCEPTED_IMAGES.includes(file.type)) return file;
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
