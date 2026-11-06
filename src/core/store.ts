import type { Listing } from './types.ts';
import { LISTINGS } from '../data/listings.ts';

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

export function latestListings(limit = 8): Listing[] {
  return [...publishedListings()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}
