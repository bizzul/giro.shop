import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeThumbnail, smallPathFor, storePhoto, SMALL_WIDTH } from '../src/lib/photo-store.ts';
import { gpsFromJpeg } from '../src/core/exif.ts';

const jpeg = (width: number, height: number, orientation?: number) => {
  const image = sharp({ create: { width, height, channels: 3, background: '#8a6f55' } }).jpeg({ quality: 90 });
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
};

/** Un client finto: registra i caricamenti, e il caricamento n-esimo (da 1) può fallire. */
function fakeClient(failAt?: number) {
  const uploads: Array<{ path: string; contentType: string }> = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
          uploads.push({ path, contentType: opts.contentType });
          return { error: uploads.length === failAt ? { message: 'spazio finito' } : null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, uploads };
}

describe('miniature delle foto', () => {
  it('480 px di larghezza in WebP, con le dimensioni vere della foto', async () => {
    const thumb = await makeThumbnail(await jpeg(1568, 1176));
    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(SMALL_WIDTH);
    expect(meta.height).toBe(360);
    expect([thumb.width, thumb.height]).toEqual([1568, 1176]);
    expect(thumb.bytes.length).toBeLessThan(30_000);
  });

  it('gira la foto secondo l\'EXIF (scattata in verticale)', async () => {
    const thumb = await makeThumbnail(await jpeg(1200, 900, 6));
    const meta = await sharp(thumb.bytes).metadata();
    expect([thumb.width, thumb.height]).toEqual([900, 1200]);
    expect([meta.width, meta.height]).toEqual([480, 640]);
  });

  it('non ingrandisce e non tiene i metadati: niente posizione GPS', async () => {
    const original = readFileSync('e2e/fixtures/foto-gps-locarno.jpg');
    expect(gpsFromJpeg(new Uint8Array(original))).not.toBeNull();
    const thumb = await makeThumbnail(original);
    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.width).toBe(480);
    expect(meta.exif).toBeUndefined();
    expect(thumb.bytes.includes('Exif')).toBe(false);
  });

  it('nome della miniatura accanto alla foto', () => {
    expect(smallPathFor('utente/annuncio/0.jpg')).toBe('utente/annuncio/0-sm.webp');
    expect(smallPathFor('utente/annuncio/1794005451373-0.jpeg')).toBe('utente/annuncio/1794005451373-0-sm.webp');
  });

  it('carica foto e miniatura; senza miniatura la foto resta, senza foto è un errore', async () => {
    const body = await jpeg(1000, 750);
    const ok = fakeClient();
    const stored = await storePhoto(ok.client, 'u/a/0.jpg', body, 'image/jpeg');
    expect(stored).toEqual({ error: null, photo: { storage_path: 'u/a/0.jpg', small_path: 'u/a/0-sm.webp', width: 1000, height: 750 } });
    expect(ok.uploads).toEqual([
      { path: 'u/a/0.jpg', contentType: 'image/jpeg' },
      { path: 'u/a/0-sm.webp', contentType: 'image/webp' },
    ]);

    const noSmall = await storePhoto(fakeClient(2).client, 'u/a/0.jpg', body, 'image/jpeg');
    expect(noSmall.error).toBeNull();
    expect(noSmall.photo?.small_path).toBeNull();

    const noPhoto = await storePhoto(fakeClient(1).client, 'u/a/0.jpg', body, 'image/jpeg');
    expect(noPhoto.error).toBe('spazio finito');
  });
});
