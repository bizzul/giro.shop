/**
 * Embedding di testi con un modello locale (transformers.js + ONNX), senza chiavi né servizi esterni:
 * EmbeddingGemma 300M (Google), quantizzato a 4 bit, 768 dimensioni, capisce italiano, tedesco, francese e inglese.
 * Il modello (~200 MB) si scarica una volta sola da Hugging Face e resta in .cache/modelli.
 *
 * Scelto dopo una prova sugli annunci veri: i modelli da ~120 MB (multilingual-e5-small,
 * paraphrase-multilingual-MiniLM) confondevano "sofà" con "soffiatori"; questo porta al divano.
 *
 * Le frasi cercate hanno il prefisso "task: search result | query: "; gli annunci arrivano già
 * nella forma "title: … | text: …" (vedi passageOf in semantic.ts).
 */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

export const EMBEDDING_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
export const EMBEDDING_DIMS = 768;

let loading: Promise<FeatureExtractionPipeline> | null = null;
let ready: FeatureExtractionPipeline | null = null;
let failed: string | null = null;

/** Carica il modello (una volta). Le chiamate successive aspettano lo stesso caricamento. */
export function loadEmbedder(): Promise<FeatureExtractionPipeline> {
  if (ready) return Promise.resolve(ready);
  loading ??= (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = process.env.PIAZZA_MODEL_CACHE ?? '.cache/modelli';
    const extractor = (await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q4' })) as FeatureExtractionPipeline;
    ready = extractor;
    failed = null;
    return extractor;
  })().catch((error: unknown) => {
    loading = null;
    failed = (error as Error).message;
    throw error;
  });
  return loading;
}

/** Il modello è già in memoria? (La ricerca non aspetta il primo caricamento.) */
export function embedderReady(): boolean {
  return ready !== null;
}

export function embedderError(): string | null {
  return failed;
}

/** Vettori normalizzati (prodotto scalare = similarità del coseno). */
export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const extractor = await loadEmbedder();
  const out = await extractor(
    texts.map((t) => (kind === 'query' ? `task: search result | query: ${t}` : t)),
    { pooling: 'mean', normalize: true },
  );
  const data = out.data as Float32Array;
  return texts.map((_, i) => data.slice(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS));
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
