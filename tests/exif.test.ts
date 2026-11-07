import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gpsFromJpeg } from '../src/core/exif.ts';
import { nearestComune } from '../src/core/comuni.ts';
import { MAX_KM } from '../src/lib/auto-comune.ts';

/** Un JPEG minimo con il solo blocco EXIF, scritto a mano in big endian ("MM"), con latitudine e longitudine date. */
function jpegWithGps(lat: [number, number, number], latRef: string, lon: [number, number, number], lonRef: string): Uint8Array {
  const tiff = new DataView(new ArrayBuffer(128));
  tiff.setUint16(0, 0x4d4d);
  tiff.setUint16(2, 42);
  tiff.setUint32(4, 8);
  // IFD0: solo il puntatore al GPS
  tiff.setUint16(8, 1);
  tiff.setUint16(10, 0x8825);
  tiff.setUint16(12, 4);
  tiff.setUint32(14, 1);
  tiff.setUint32(18, 26);
  tiff.setUint32(22, 0);
  // IFD del GPS: N/S, latitudine, E/W, longitudine
  const entries: Array<[number, number, number, number | string]> = [
    [1, 2, 2, latRef],
    [2, 5, 3, 80],
    [3, 2, 2, lonRef],
    [4, 5, 3, 104],
  ];
  tiff.setUint16(26, entries.length);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 28 + i * 12;
    tiff.setUint16(at, tag);
    tiff.setUint16(at + 2, type);
    tiff.setUint32(at + 4, count);
    if (typeof value === 'string') tiff.setUint8(at + 8, value.charCodeAt(0));
    else tiff.setUint32(at + 8, value);
  });
  const rationals = (at: number, [d, m, s]: [number, number, number]) => {
    [[d, 1], [m, 1], [Math.round(s * 100), 100]].forEach(([num, den], i) => {
      tiff.setUint32(at + i * 8, num);
      tiff.setUint32(at + i * 8 + 4, den);
    });
  };
  rationals(80, lat);
  rationals(104, lon);

  const body = new Uint8Array(tiff.buffer);
  const app1 = new Uint8Array(4 + 6 + body.length);
  app1.set([0xff, 0xe1, ((app1.length - 2) >> 8) & 0xff, (app1.length - 2) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(body, 10);
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

describe('coordinate GPS delle foto', () => {
  it('legge la foto di prova scritta da sharp (little endian): Locarno', () => {
    const point = gpsFromJpeg(new Uint8Array(readFileSync('e2e/fixtures/foto-gps-locarno.jpg')));
    expect(point?.lat).toBeCloseTo(46.1708, 4);
    expect(point?.lon).toBeCloseTo(8.7995, 4);
    const near = nearestComune(point!);
    expect(near.comune.name).toBe('Locarno');
    expect(near.km).toBeLessThan(1);
  });

  it('legge anche il big endian e i segni di sud e ovest', () => {
    const point = gpsFromJpeg(jpegWithGps([33, 51, 54.5], 'S', [151, 12, 36], 'W'));
    expect(point?.lat).toBeCloseTo(-(33 + 51 / 60 + 54.5 / 3600), 6);
    expect(point?.lon).toBeCloseTo(-(151 + 12 / 60 + 36 / 3600), 6);
  });

  it('niente coordinate, coordinate zero o file non validi: null', () => {
    expect(gpsFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeNull();
    expect(gpsFromJpeg(jpegWithGps([0, 0, 0], 'N', [0, 0, 0], 'E'))).toBeNull();
    expect(gpsFromJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(gpsFromJpeg(jpegWithGps([46, 0, 0], 'N', [9, 0, 0], 'E').slice(0, 60))).toBeNull();
    expect(gpsFromJpeg(new Uint8Array(0))).toBeNull();
  });
});

describe('comune più vicino', () => {
  it('in Ticino propone il comune, fuori resta troppo lontano', () => {
    expect(nearestComune({ lat: 46.0037, lon: 8.9511 }).comune.name).toBe('Lugano');
    expect(nearestComune({ lat: 46.19, lon: 9.02 }).comune.name).toBe('Bellinzona');
    // Zurigo: il più vicino è lontano più del limite, quindi non si compila niente
    expect(nearestComune({ lat: 47.3769, lon: 8.5417 }).km).toBeGreaterThan(MAX_KM);
  });
});
