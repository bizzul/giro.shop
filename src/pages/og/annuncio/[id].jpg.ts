import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { getPhoto } from '../../../core/store.ts';
import { SUPABASE_SERVER_URL, SUPABASE_URL } from '../../../lib/supabase.ts';

/**
 * Anteprima di un annuncio per le condivisioni (WhatsApp, Telegram, Facebook, X…): la prima foto in JPEG 1200×630,
 * intera e centrata su uno sfondo sfocato della foto stessa (le foto verticali non perdono la parte alta e bassa),
 * con il marchio in un angolo. JPEG perché WhatsApp e altri non mostrano sempre le anteprime in WebP.
 */
const W = 1200;
const H = 630;

const BADGE = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76" viewBox="0 0 32 32">
    <rect x="1" y="1" width="30" height="30" rx="9" fill="#003366"/>
    <g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5.5 23.5L11.5 12L16 19L20.5 12L26.5 23.5"/>
    </g></svg>`,
);

/** La foto: quelle di esempio stanno sul sito, le altre su Supabase (letta dall'indirizzo interno, se c'è). */
function sourceUrl(src: string, origin: string): string {
  if (src.startsWith('/')) return `${origin}${src}`;
  if (SUPABASE_URL && SUPABASE_SERVER_URL && src.startsWith(SUPABASE_URL)) return SUPABASE_SERVER_URL + src.slice(SUPABASE_URL.length);
  return src;
}

export const GET: APIRoute = async ({ params, url, redirect }) => {
  const photo = getPhoto(params.id ?? '');
  if (!photo) return redirect('/og.png', 302);
  try {
    const res = await fetch(sourceUrl(photo.src, url.origin), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`foto ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    const [background, foreground] = await Promise.all([
      sharp(input).rotate().resize(W, H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.85 }).toBuffer(),
      sharp(input).rotate().resize(W, H, { fit: 'inside' }).toBuffer(),
    ]);
    const jpeg = await sharp(background)
      .composite([
        { input: foreground, gravity: 'center' },
        { input: BADGE, left: 36, top: H - 76 - 36 },
      ])
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
    });
  } catch {
    return redirect('/og.png', 302);
  }
};
