/**
 * Coordinate GPS dentro una foto JPEG (EXIF), lette nel browser prima che la foto venga ridotta.
 * Servono solo a proporre il comune di ritiro: le coordinate non lasciano il dispositivo.
 * Niente librerie: si cerca il blocco APP1 "Exif", poi nel TIFF il puntatore al GPS (tag 0x8825)
 * e lì latitudine e longitudine (gradi, minuti, secondi come frazioni) con N/S ed E/W.
 */

export interface GpsPoint {
  lat: number;
  lon: number;
}

const GPS_IFD_POINTER = 0x8825;
const LAT_REF = 1;
const LAT = 2;
const LON_REF = 3;
const LON = 4;
const TYPE_RATIONAL = 5;

/** Le coordinate della foto, o null se non ci sono, sono zero o il file non si legge. */
export function gpsFromJpeg(bytes: Uint8Array): GpsPoint | null {
  try {
    const tiff = findExifTiff(bytes);
    return tiff ? readGps(tiff) : null;
  } catch {
    return null;
  }
}

/** Il TIFF dentro il blocco APP1 "Exif\0\0", come vista sui suoi byte. */
function findExifTiff(bytes: Uint8Array): DataView | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Inizio dell'immagine vera e propria o fine del file: i metadati sono prima
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    const start = offset + 4;
    if (
      marker === 0xe1 &&
      start + 6 <= bytes.length &&
      bytes[start] === 0x45 && // E
      bytes[start + 1] === 0x78 && // x
      bytes[start + 2] === 0x69 && // i
      bytes[start + 3] === 0x66 && // f
      bytes[start + 4] === 0 &&
      bytes[start + 5] === 0
    ) {
      const tiffStart = start + 6;
      const tiffLength = Math.min(length - 8, bytes.length - tiffStart);
      if (tiffLength < 8) return null;
      return new DataView(bytes.buffer, bytes.byteOffset + tiffStart, tiffLength);
    }
    offset += 2 + length;
  }
  return null;
}

function readGps(tiff: DataView): GpsPoint | null {
  const order = tiff.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null; // "II" o "MM"
  const little = order === 0x4949;
  if (tiff.getUint16(2, little) !== 42) return null;

  const ifd0 = tiff.getUint32(4, little);
  const gpsEntry = findEntry(tiff, ifd0, GPS_IFD_POINTER, little);
  if (!gpsEntry) return null;
  const gpsIfd = tiff.getUint32(gpsEntry + 8, little);

  const latRef = asciiRef(tiff, findEntry(tiff, gpsIfd, LAT_REF, little));
  const lonRef = asciiRef(tiff, findEntry(tiff, gpsIfd, LON_REF, little));
  const lat = degrees(tiff, findEntry(tiff, gpsIfd, LAT, little), little);
  const lon = degrees(tiff, findEntry(tiff, gpsIfd, LON, little), little);
  if (lat == null || lon == null || !latRef || !lonRef) return null;

  const point = { lat: latRef === 'S' ? -lat : lat, lon: lonRef === 'W' ? -lon : lon };
  // Alcune fotocamere scrivono 0,0 quando non hanno il segnale
  if (point.lat === 0 && point.lon === 0) return null;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return null;
  return point;
}

/** Posizione (nel TIFF) della voce con quel tag dentro una IFD, o null. */
function findEntry(tiff: DataView, ifd: number, tag: number, little: boolean): number | null {
  if (ifd < 8 || ifd + 2 > tiff.byteLength) return null;
  const count = tiff.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.byteLength) return null;
    if (tiff.getUint16(entry, little) === tag) return entry;
  }
  return null;
}

/** "N", "S", "E" o "W": un carattere ASCII scritto dentro la voce stessa. */
function asciiRef(tiff: DataView, entry: number | null): string | null {
  if (entry == null) return null;
  const ref = String.fromCharCode(tiff.getUint8(entry + 8)).toUpperCase();
  return 'NSEW'.includes(ref) ? ref : null;
}

/** Tre frazioni (gradi, minuti, secondi) in gradi decimali. */
function degrees(tiff: DataView, entry: number | null, little: boolean): number | null {
  if (entry == null) return null;
  if (tiff.getUint16(entry + 2, little) !== TYPE_RATIONAL || tiff.getUint32(entry + 4, little) < 3) return null;
  const at = tiff.getUint32(entry + 8, little);
  if (at + 24 > tiff.byteLength) return null;
  const part = (i: number) => {
    const den = tiff.getUint32(at + i * 8 + 4, little);
    return den === 0 ? 0 : tiff.getUint32(at + i * 8, little) / den;
  };
  return part(0) + part(1) / 60 + part(2) / 3600;
}
