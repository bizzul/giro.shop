/**
 * Traduzione di un annuncio con Claude, tenuta nel database finché il testo non cambia.
 * GET /traduci?id=l-001&lang=de → { title, description }
 */
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { getListing } from '../core/store.ts';
import { LANGUAGES, translateListing, type Language } from '../core/claude.ts';
import { adminClient } from '../lib/admin.ts';
import { allow, claudeKey } from '../lib/claude.ts';

export const GET: APIRoute = async ({ url, clientAddress }) => {
  const key = claudeKey();
  const listing = getListing(url.searchParams.get('id') ?? '');
  const lang = url.searchParams.get('lang') as Language;
  if (!key || !listing || !(lang in LANGUAGES)) return new Response('Traduzione non disponibile', { status: 404 });

  const hash = createHash('sha256').update(`${listing.title}\n${listing.description}`).digest('hex').slice(0, 16);
  const admin = adminClient();
  const { data: cached } = admin
    ? await admin.from('listing_translations').select('title, description, source_hash').eq('listing_id', listing.id).eq('lang', lang).maybeSingle()
    : { data: null };
  if (cached && cached.source_hash === hash) {
    return Response.json({ title: cached.title, description: cached.description }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  }

  // Le traduzioni nuove costano: al massimo 20 l'ora per indirizzo
  if (!allow(`traduci:${clientAddress}`, 20, 36e5)) return new Response('Troppe traduzioni, riprova più tardi', { status: 429 });
  try {
    const out = await translateListing(key, listing, lang);
    await admin?.from('listing_translations').upsert({ listing_id: listing.id, lang, source_hash: hash, title: out.title, description: out.description });
    return Response.json(out);
  } catch (error) {
    console.warn(`[giro] traduzione di ${listing.id}: ${(error as Error).message}`);
    return new Response('Traduzione non riuscita', { status: 502 });
  }
};
