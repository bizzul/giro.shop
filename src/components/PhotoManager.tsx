import { useRef, useState } from 'preact/hooks';
import { makeCover, moveItem, MAX_LISTING_PHOTOS } from '../core/photos.ts';
import { ACCEPTED_IMAGES, MAX_IMAGE_BYTES, photoGps, shrinkImage } from '../lib/images.ts';
import type { GpsPoint } from '../core/exif.ts';

/** Una foto nei riquadri: già salvata (solo url) o appena scelta (con il file). */
export interface PhotoItem {
  key: string;
  url: string;
  file?: File;
  /** Dove è stata scattata (EXIF della foto originale): resta nel browser, serve a proporre il comune. */
  gps?: GpsPoint;
}

interface Props {
  items: PhotoItem[];
  onChange: (items: PhotoItem[]) => void;
  /** Impedisce di togliere l'ultima foto. */
  keepOne?: boolean;
  max?: number;
  /** Messaggio da mostrare sotto i riquadri (es. "serve almeno una foto"). */
  message?: string | null;
}

let counter = 0;

/** Riduce i file scelti e li trasforma in riquadri; scarta quelli che non sono immagini valide. */
async function toItems(files: File[]): Promise<{ items: PhotoItem[]; rejected: string[] }> {
  const items: PhotoItem[] = [];
  const rejected: string[] = [];
  for (const original of files) {
    if (!original.type.startsWith('image/')) {
      rejected.push(original.name);
      continue;
    }
    // Le coordinate si leggono dall'originale: la foto ridotta non le ha più, e con la posizione si ridisegna sempre
    const gps = await photoGps(original);
    const file = await shrinkImage(original, { stripMetadata: Boolean(gps) });
    if (!ACCEPTED_IMAGES.includes(file.type) || file.size > MAX_IMAGE_BYTES || (gps && file === original)) {
      rejected.push(original.name);
      continue;
    }
    items.push({ key: `nuova-${Date.now()}-${++counter}`, url: URL.createObjectURL(file), file, ...(gps ? { gps } : {}) });
  }
  return { items, rejected };
}

/**
 * Riquadri delle foto: la prima è la copertina (più grande). Si aggiungono con il riquadro "+"
 * (clic o trascinando file), si riordinano trascinando (mouse sulla foto, dito sulla maniglia
 * o frecce da tastiera) e si sceglie la copertina con un tocco.
 */
export default function PhotoManager({ items, onChange, keepOne = false, max = MAX_LISTING_PHOTOS, message }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(items);
  latest.current = items;

  const canRemove = !keepOne || items.length > 1;

  async function add(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    const room = max - latest.current.length;
    if (room <= 0) {
      setError(`Al massimo ${max} foto.`);
      return;
    }
    setBusy(true);
    const { items: added, rejected } = await toItems(files.slice(0, room));
    setBusy(false);
    if (added.length) {
      onChange([...latest.current, ...added]);
      setAnnounce(added.length === 1 ? 'Foto aggiunta' : `${added.length} foto aggiunte`);
    }
    const notes = [];
    if (rejected.length) notes.push(`${rejected.join(', ')}: non è un'immagine JPEG, PNG o WebP sotto i 5 MB.`);
    if (files.length > room) notes.push(`Al massimo ${max} foto: le altre non sono state aggiunte.`);
    if (notes.length) setError(notes.join(' '));
  }

  function remove(index: number) {
    if (!canRemove) return;
    const item = items[index];
    if (item.file) URL.revokeObjectURL(item.url);
    onChange(items.filter((_, i) => i !== index));
    setAnnounce('Foto tolta');
  }

  function setCover(index: number) {
    onChange(makeCover(items, index));
    setAnnounce('Copertina cambiata');
  }

  /** Riordino con il puntatore: funziona con mouse e dito, senza librerie. */
  function startDrag(event: PointerEvent, key: string, fromHandle: boolean) {
    if (!fromHandle && event.pointerType !== 'mouse') return; // col dito si trascina dalla maniglia, così la pagina scorre
    if (event.button !== 0) return;
    if (!fromHandle && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const tile = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-photo-key]');
    if (!tile) return;
    tile.setPointerCapture(event.pointerId);
    setDragKey(key);

    const move = (e: PointerEvent) => {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-photo-key]');
      const list = latest.current;
      const from = list.findIndex((p) => p.key === key);
      const to = over ? list.findIndex((p) => p.key === over.dataset.photoKey) : -1;
      if (from >= 0 && to >= 0 && from !== to) onChange(moveItem(list, from, to));
    };
    const end = () => {
      tile.removeEventListener('pointermove', move);
      tile.removeEventListener('pointerup', end);
      tile.removeEventListener('pointercancel', end);
      setDragKey(null);
      setAnnounce('Ordine aggiornato');
    };
    tile.addEventListener('pointermove', move);
    tile.addEventListener('pointerup', end);
    tile.addEventListener('pointercancel', end);
  }

  function onKey(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (step) {
      event.preventDefault();
      const to = index + step;
      if (to < 0 || to >= items.length) return;
      onChange(moveItem(items, index, to));
      setAnnounce(to === 0 ? 'Ora è la copertina' : `Spostata in posizione ${to + 1}`);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-photo-key="${items[index].key}"]`)?.focus());
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && canRemove) {
      event.preventDefault();
      remove(index);
    }
  }

  return (
    <div class="photos-field">
      <div class="photos-head">
        <span class="label">
          Foto ({items.length}/{max})
        </span>
        {items.length > 1 && <span class="small">La prima è la copertina. Trascina per cambiare l'ordine.</span>}
      </div>

      <div
        className={`ph-grid${dropping ? ' dropping' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types.includes('Files')) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer?.files.length) return;
          e.preventDefault();
          setDropping(false);
          add(e.dataTransfer.files);
        }}
      >
        {items.map((item, i) => (
          <div
            key={item.key}
            data-photo-key={item.key}
            className={`ph-tile${i === 0 ? ' cover' : ''}${dragKey === item.key ? ' dragging' : ''}`}
            tabIndex={0}
            aria-label={`${i === 0 ? 'Copertina' : `Foto ${i + 1}`}. Frecce per spostarla${canRemove ? ', Canc per toglierla' : ''}.`}
            onPointerDown={(e) => startDrag(e, item.key, false)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <img src={item.url} alt="" draggable={false} />
            {i === 0 ? (
              <span class="ph-badge">Copertina</span>
            ) : (
              <button type="button" class="ph-cover" onClick={() => setCover(i)}>
                Copertina
              </button>
            )}
            {canRemove && (
              <button type="button" class="ph-remove" aria-label={`Togli la foto ${i + 1}`} onClick={() => remove(i)}>
                ×
              </button>
            )}
            {items.length > 1 && (
              <span class="ph-handle" aria-hidden="true" onPointerDown={(e) => startDrag(e, item.key, true)}>
                <svg viewBox="0 0 12 12"><circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" /><circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" /><circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" /></svg>
              </span>
            )}
          </div>
        ))}

        {items.length < max && (
          <button
            type="button"
            className={`ph-add${items.length === 0 ? ' empty' : ''}`}
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            aria-label="Aggiungi foto"
          >
            <span class="ph-plus" aria-hidden="true">
              {busy ? '…' : '+'}
            </span>
            {items.length === 0 && <span class="ph-hint">Aggiungi foto: tocca o trascinale qui</span>}
          </button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          add(input.files);
          input.value = '';
        }}
      />

      {(error || message) && (
        <p class="error" role="alert">
          {error ?? message}
        </p>
      )}
      <span class="sr" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
