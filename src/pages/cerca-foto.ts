/**
 * Cerca con una foto: Claude guarda l'immagine e restituisce una frase di ricerca.
 * POST /cerca-foto (multipart, campo "foto") → { q: "bici da corsa Bianchi" }
 */
import type { APIRoute } from 'astro';
import { IMAGE_TYPES, MAX_PHOTO_BYTES, type ImageMediaType } from '../core/draft.ts';
import { queryFromPhoto } from '../core/claude.ts';
import { allow, claudeKey } from '../lib/claude.ts';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const key = claudeKey();
  if (!key) return Response.json({ error: 'La ricerca con foto non è attiva.' }, { status: 404 });
  if (!allow(`foto:${clientAddress}`, 15, 36e5)) return Response.json({ error: 'Troppe ricerche con foto: riprova tra un po\'.' }, { status: 429 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('foto');
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: 'Manca la foto.' }, { status: 400 });
  if (!IMAGE_TYPES.includes(file.type as ImageMediaType) || file.size > MAX_PHOTO_BYTES) {
    return Response.json({ error: 'Serve una foto JPEG, PNG o WebP sotto i 5 MB.' }, { status: 400 });
  }
  try {
    const data = Buffer.from(await file.arrayBuffer()).toString('base64');
    const q = await queryFromPhoto(key, { mediaType: file.type as ImageMediaType, data });
    return Response.json({ q });
  } catch (error) {
    console.warn(`[giro] ricerca con foto: ${(error as Error).message}`);
    return Response.json({ error: 'Non sono riuscito a riconoscere l\'oggetto. Prova con un\'altra foto.' }, { status: 502 });
  }
};
