/**
 * La bozza di Vendi salvata nel browser (IndexedDB, foto comprese) quando si va ad accedere:
 * il link via email riapre Vendi e la bozza si riprende da dove era. Resta solo in questo browser, al massimo 7 giorni,
 * e si cancella dopo la pubblicazione o con «Ricomincia».
 */
import type { Draft } from '../core/draft.ts';
import type { GpsPoint } from '../core/exif.ts';

export interface SavedSellDraft {
  savedAt: number;
  draft: Draft;
  title: string;
  description: string;
  price: string;
  comune: string;
  shipping: boolean;
  shippingChf: string;
  photos: Array<{ file: File; gps?: GpsPoint }>;
}

const DB = 'giro';
const STORE = 'bozze';
const KEY = 'vendi';
const MAX_AGE = 7 * 24 * 3600 * 1000;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const conn = await db();
  return new Promise<T>((resolve, reject) => {
    const req = fn(conn.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => conn.close());
}

export async function saveSellDraft(data: Omit<SavedSellDraft, 'savedAt'>): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put({ ...data, savedAt: Date.now() }, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadSellDraft(): Promise<SavedSellDraft | null> {
  try {
    const saved = await run<SavedSellDraft | undefined>('readonly', (s) => s.get(KEY));
    if (!saved || Date.now() - saved.savedAt > MAX_AGE) return null;
    return saved;
  } catch {
    return null;
  }
}

export async function clearSellDraft(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    // Niente da cancellare o IndexedDB non disponibile
  }
}
