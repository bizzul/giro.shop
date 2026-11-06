import type { Listing, Photo } from './types.ts';
import { LISTINGS } from '../data/listings.ts';
import { PHOTOS } from '../data/photos.ts';

/**
 * Accesso agli annunci. Nel prototipo legge i dati di prova in memoria;
 * nella Fase 1 queste funzioni leggeranno da Supabase senza cambiare chi le usa.
 */
export function allListings(): Listing[] {
  return LISTINGS;
}

export function publishedListings(): Listing[] {
  return LISTINGS.filter((l) => l.status === 'pubblicato');
}

export function getListing(id: string): Listing | undefined {
  return LISTINGS.find((l) => l.id === id);
}

/** Foto di esempio dell'annuncio (nel prototipo vengono da Openverse, con crediti). */
export function getPhoto(listingId: string): Photo | undefined {
  return PHOTOS[listingId];
}

const SOURCE_NAMES: Record<string, string> = { flickr: 'Flickr', wikimedia: 'Wikimedia Commons' };

export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function latestListings(limit = 8): Listing[] {
  return [...publishedListings()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}
