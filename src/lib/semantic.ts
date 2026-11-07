/**
 * Ricerca per significato, lato server: "sofà" trova il divano, "Fahrrad" le bici, "per fare il caffè" la Jura.
 *
 * - Ogni annuncio pubblicato ha un vettore (EmbeddingGemma, in locale) nella tabella listing_embeddings,
 *   che solo il server legge e scrive. Si ricalcola quando cambiano il testo o il modello.
 * - I vettori stanno anche in memoria: confrontare una frase con tutti gli annunci costa pochi millisecondi.
 * - La ricerca non aspetta mai il modello: finché non è pronto (primo avvio, download) si cerca solo per parole
 *   e il caricamento parte in sottofondo.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getListing, publishedListings } from '../core/store.ts';
import { meaningMatches, meaningText, type Meaning } from '../core/search.ts';
import type { Listing } from '../core/types.ts';
import { adminClient } from './admin.ts';
import { EMBEDDING_MODEL, dot, embed, embedderReady, loadEmbedder } from './embeddings.ts';

/** Il testo di un annuncio come lo vede il modello: titolo, etichette, descrizione (accorciata). */
export function passageOf(l: Pick<Listing, 'title' | 'description' | 'tags'>): string {
  return `title: ${l.title} | text: ${[(l.tags ?? []).join(', '), l.description].filter(Boolean).join('. ')}`.slice(0, 700);
}

const hashOf = (text: string) => createHash('sha1').update(`${EMBEDDING_MODEL}\n${text}`).digest('hex');

/** Vettori in memoria, per id dell'annuncio. */
const vectors = new Map<string, Float32Array>();
let vectorsLoaded = false;
let warming: Promise<void> | null = null;
/** Dopo un errore (database, download del modello) si riprova tra qualche minuto, non a ogni ricerca. */
let retryAfter = 0;
const RETRY_MS = 5 * 60_000;

const parseVector = (value: unknown): Float32Array =>
  Float32Array.from(typeof value === 'string' ? (JSON.parse(value) as number[]) : (value as number[]));
const formatVector = (v: Float32Array) => `[${Array.from(v).join(',')}]`;

async function loadVectors(admin: SupabaseClient): Promise<void> {
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from('listing_embeddings')
      .select('listing_id, embedding')
      .eq('model', EMBEDDING_MODEL)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) vectors.set(row.listing_id as string, parseVector(row.embedding));
    if (!data || data.length < pageSize) break;
  }
  vectorsLoaded = true;
}

/**
 * Calcola i vettori mancanti o vecchi degli annunci pubblicati (o solo di `ids`) e li salva.
 * Restituisce quanti ne ha calcolati.
 */
export async function syncEmbeddings(ids?: string[]): Promise<number> {
  const admin = adminClient();
  if (!admin) return 0;
  const listings = ids ? ids.map((id) => getListing(id)).filter((l): l is Listing => Boolean(l)) : publishedListings();
  if (!listings.length) return 0;
  const wanted = new Map(listings.map((l) => [l.id, passageOf(l)]));
  const known = new Map<string, string>();
  const idList = [...wanted.keys()];
  for (let i = 0; i < idList.length; i += 200) {
    const { data } = await admin
      .from('listing_embeddings')
      .select('listing_id, source_hash')
      .in('listing_id', idList.slice(i, i + 200));
    for (const row of data ?? []) known.set(row.listing_id as string, row.source_hash as string);
  }
  const todo = [...wanted].filter(([id, text]) => known.get(id) !== hashOf(text) || !vectors.has(id));
  let done = 0;
  for (let i = 0; i < todo.length; i += 16) {
    const batch = todo.slice(i, i + 16);
    const stale = batch.filter(([id, text]) => known.get(id) !== hashOf(text));
    // Già nel database ma non in memoria: basta caricarlo
    const fresh = batch.filter(([id, text]) => known.get(id) === hashOf(text));
    if (fresh.length) {
      const { data } = await admin.from('listing_embeddings').select('listing_id, embedding').in('listing_id', fresh.map(([id]) => id));
      for (const row of data ?? []) vectors.set(row.listing_id as string, parseVector(row.embedding));
    }
    if (!stale.length) continue;
    const vecs = await embed(stale.map(([, text]) => text), 'passage');
    const rows = stale.map(([id, text], j) => ({
      listing_id: id,
      model: EMBEDDING_MODEL,
      source_hash: hashOf(text),
      embedding: formatVector(vecs[j]),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await admin.from('listing_embeddings').upsert(rows);
    if (error) throw new Error(`vettori non salvati: ${error.message}`);
    stale.forEach(([id], j) => vectors.set(id, vecs[j]));
    done += stale.length;
  }
  return done;
}

/** Prepara tutto in sottofondo: modello, vettori salvati, vettori mancanti. Una volta sola alla volta. */
export function warmUpSemantic(): Promise<void> {
  if (!warming && Date.now() < retryAfter) return Promise.resolve();
  warming ??= (async () => {
    const admin = adminClient();
    if (!admin) return;
    await loadEmbedder();
    if (!vectorsLoaded) await loadVectors(admin);
    const computed = await syncEmbeddings();
    if (computed) console.info(`[giro] ricerca per significato: ${computed} annunci indicizzati`);
  })()
    .catch((e) => {
      retryAfter = Date.now() + RETRY_MS;
      console.warn(`[giro] ricerca per significato non disponibile per ora (riprovo tra 5 minuti): ${(e as Error).message}`);
    })
    .finally(() => {
      warming = null;
    });
  return warming;
}

/** Vettori delle ultime frasi cercate: la stessa ricerca (pagina, "Mostra altri", ordine) non ricalcola. */
const queryCache = new Map<string, Float32Array>();

/**
 * Similarità grezze (0–1) tra una frase e ogni annuncio pubblicato.
 * null se non serve (la frase è solo un filtro) o se il modello non è ancora pronto: allora si cerca per parole.
 */
async function similarities(query: string): Promise<Map<string, number> | null> {
  const text = meaningText(query).toLowerCase();
  if (!text) return null;
  if (!embedderReady() || !vectorsLoaded) {
    void warmUpSemantic();
    return null;
  }
  let q = queryCache.get(text);
  if (!q) {
    [q] = await embed([text], 'query');
    queryCache.set(text, q);
    if (queryCache.size > 300) queryCache.delete(queryCache.keys().next().value!);
  }
  const live = new Set(publishedListings().map((l) => l.id));
  const sims = new Map<string, number>();
  for (const [id, v] of vectors) if (live.has(id)) sims.set(id, dot(q, v));
  return sims;
}

/** Per la ricerca: gli annunci abbastanza vicini per significato (soglia e vicinanza al più simile). */
export async function meaningFor(query: string): Promise<Meaning | null> {
  const sims = await similarities(query);
  return sims ? meaningMatches(sims) : null;
}

/** Calcola subito il vettore di un annuncio, se il modello è pronto (altrimenti lo farà il riscaldamento o la manutenzione). */
export async function embedListing(listingId: string): Promise<void> {
  if (!embedderReady()) return;
  await syncEmbeddings([listingId]).catch((e) => console.warn(`[giro] vettore di ${listingId}: ${(e as Error).message}`));
}

/** Dopo una modifica del testo: il vettore dell'annuncio si aggiorna senza far aspettare nessuno. */
export function embedListingLater(listingId: string): void {
  void embedListing(listingId);
}

/**
 * Per gli avvisi: quanto un annuncio è simile per significato a una ricerca salvata (similarità grezza).
 * Qui non vale "vicino al più simile": un secondo divano deve avvisare anche se il primo era più simile.
 * La soglia, più alta di quella della ricerca, la applica matchesSearch (ALERT_MEANING_MIN).
 */
export async function similarityFor(query: string, listingId: string): Promise<number | undefined> {
  return (await similarities(query))?.get(listingId);
}

/**
 * Un annuncio di un'altra persona con un testo quasi uguale (vettori quasi identici), per il rischio truffa.
 * null se il modello non è pronto o se non ce n'è.
 */
export function nearDuplicateOf(listingId: string, min = 0.97): string | null {
  const v = vectors.get(listingId);
  const me = getListing(listingId);
  if (!v || !me) return null;
  for (const [id, other] of vectors) {
    if (id === listingId) continue;
    const l = getListing(id);
    if (l && l.sellerId !== me.sellerId && dot(v, other) >= min) return id;
  }
  return null;
}

/** Il vettore di una frase cercata, dalla cache se c'è. null se il modello non è pronto. */
async function queryVector(query: string): Promise<Float32Array | null> {
  const text = meaningText(query).toLowerCase();
  if (!text || !embedderReady()) return null;
  let q = queryCache.get(text);
  if (!q) {
    [q] = await embed([text], 'query');
    queryCache.set(text, q);
    if (queryCache.size > 300) queryCache.delete(queryCache.keys().next().value!);
  }
  return q;
}

/**
 * Somiglianza (grezza) tra alcune frasi cercate e alcuni annunci già indicizzati: per "lo cercano in 4"
 * su pochi annunci si confrontano solo quelli, non tutto il catalogo. Mappa frase → annuncio → somiglianza.
 */
export async function similaritiesFor(queries: string[], listingIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!embedderReady() || !vectorsLoaded) {
    void warmUpSemantic();
    return out;
  }
  for (const query of new Set(queries)) {
    const q = await queryVector(query);
    if (!q) continue;
    const sims = new Map<string, number>();
    for (const id of listingIds) {
      const v = vectors.get(id);
      if (v) sims.set(id, dot(q, v));
    }
    out.set(query, sims);
  }
  return out;
}

/** Somiglianza tra un testo che non ha ancora un vettore (una bozza) e alcune frasi cercate. */
export async function similaritiesToText(text: Pick<Listing, 'title' | 'description' | 'tags'>, queries: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!embedderReady()) {
    void warmUpSemantic();
    return out;
  }
  const [p] = await embed([passageOf(text)], 'passage');
  for (const query of new Set(queries)) {
    const q = await queryVector(query);
    if (q) out.set(query, dot(p, q));
  }
  return out;
}
