/**
 * Suggerimenti per il campo di ricerca, mentre si scrive.
 * GET /suggerimenti?q=scrivania in no → ["scrivania in noce", …]
 */
import type { APIRoute } from 'astro';
import { suggest } from '../core/suggest.ts';
import { publishedListings } from '../core/store.ts';

export const GET: APIRoute = ({ url }) => {
  const q = url.searchParams.get('q')?.slice(0, 200) ?? '';
  return Response.json(suggest(q, publishedListings()), {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
};
