/**
 * Ordine delle foto di un annuncio. La prima è la copertina: grande nella scheda e nelle card.
 * Funzioni pure, usate sia dal browser (riquadri) sia dal server (salvataggio).
 */

export const MIN_PHOTOS = 1;
export const MAX_LISTING_PHOTOS = 5;

/** Sposta un elemento da una posizione a un'altra. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Porta un elemento in prima posizione: diventa la copertina. */
export function makeCover<T>(list: T[], index: number): T[] {
  return moveItem(list, index, 0);
}

export type PhotoSlot = { kind: 'existing'; path: string } | { kind: 'new'; fileIndex: number };

/**
 * Legge l'ordine inviato dal form: "e:<percorso>" per una foto già salvata, "n:<indice>" per un file nuovo.
 * Controlla che ogni voce esista, che non ci siano doppioni e che il numero sia tra 1 e 5.
 */
export function planPhotoOrder(
  order: string[],
  existingPaths: string[],
  newFileCount: number,
): { ok: true; slots: PhotoSlot[] } | { ok: false; error: string } {
  if (order.length < MIN_PHOTOS) return { ok: false, error: 'Serve almeno una foto.' };
  if (order.length > MAX_LISTING_PHOTOS) return { ok: false, error: `Al massimo ${MAX_LISTING_PHOTOS} foto per annuncio.` };

  const known = new Set(existingPaths);
  const seen = new Set<string>();
  const slots: PhotoSlot[] = [];
  for (const entry of order) {
    if (seen.has(entry)) return { ok: false, error: 'La stessa foto compare due volte.' };
    seen.add(entry);
    if (entry.startsWith('e:') && known.has(entry.slice(2))) {
      slots.push({ kind: 'existing', path: entry.slice(2) });
    } else if (/^n:\d+$/.test(entry) && Number(entry.slice(2)) < newFileCount) {
      slots.push({ kind: 'new', fileIndex: Number(entry.slice(2)) });
    } else {
      return { ok: false, error: 'Una delle foto non è più disponibile. Ricarica la pagina e riprova.' };
    }
  }
  return { ok: true, slots };
}
