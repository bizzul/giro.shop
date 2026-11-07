import type { APIRoute } from 'astro';
import { getListing } from '../core/store.ts';
import { adminClient } from '../lib/admin.ts';
import { allow } from '../lib/claude.ts';

/**
 * Una visita a una scheda annuncio, per le statistiche di chi vende.
 * La scheda è in cache (uguale per tutti), quindi la visita arriva dal browser, una volta per sessione.
 * Non si salva chi guarda: solo un conteggio per annuncio e giorno. Le visite di chi vende non contano.
 */
export const POST: APIRoute = async ({ url, locals }) => {
  const id = url.searchParams.get('a') ?? '';
  const listing = getListing(id);
  if (!listing || listing.status !== 'pubblicato') return new Response(null, { status: 204 });
  if (locals.user && locals.user.id === listing.sellerId) return new Response(null, { status: 204 });
  // Un tetto per annuncio: niente numeri gonfiati da chi ricarica in automatico
  if (!allow(`vista:${id}`, 600, 60 * 60_000)) return new Response(null, { status: 204 });
  await adminClient()?.rpc('count_listing_view', { p_listing_id: id });
  return new Response(null, { status: 204 });
};
