import { useEffect, useState } from 'preact/hooks';
import { actions } from 'astro:actions';
import type { Draft } from '../core/draft.ts';
import { CONDITION_LABEL, formatChf } from '../core/format.ts';
import { getCategory } from '../core/categories.ts';

interface Props {
  comuni: string[];
}

const MAX_PHOTOS = 5;
const MAX_SIDE = 1568;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Riduce le foto del telefono prima dell'invio: caricamento più rapido e sotto i limiti dell'API. */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && ACCEPTED.includes(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('conversione non riuscita'))), 'image/jpeg', 0.85),
    );
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    // Formato che il browser non sa leggere (es. HEIC): lo segnalerà il server.
    return file;
  }
}

interface Photo {
  file: File;
  url: string;
}

export default function SellForm({ comuni }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notes, setNotes] = useState('');
  const [comune, setComune] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = Array.from(list).slice(0, room);
    const ready = await Promise.all(picked.map(shrink));
    setPhotos((prev) => [...prev, ...ready.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    if (list.length > room) setError(`Puoi usare al massimo ${MAX_PHOTOS} foto: le altre non sono state aggiunte.`);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function submit(event: Event) {
    event.preventDefault();
    setError(null);
    if (!photos.length && !notes.trim()) {
      setError('Aggiungi almeno una foto o due righe di descrizione.');
      return;
    }
    setStatus('working');
    const form = new FormData();
    photos.forEach((p) => form.append('photos', p.file));
    if (notes.trim()) form.append('notes', notes.trim());
    if (comune) form.append('comune', comune);
    const { data, error: actionError } = await actions.createDraft(form);
    if (actionError || !data) {
      setStatus('idle');
      setError(actionError?.message ?? 'Qualcosa non ha funzionato. Riprova.');
      return;
    }
    setDraft(data);
    setTitle(data.title);
    setDescription(data.description);
    setPrice(data.price ? String(data.price.mid) : '');
    setStatus('done');
  }

  function restart() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setNotes('');
    setDraft(null);
    setStatus('idle');
    setError(null);
  }

  if (status === 'done' && draft) {
    const p = draft.price;
    const span = p ? p.high - p.low : 0;
    const pos = p && span > 0 ? Math.min(100, Math.max(0, ((Number(price) - p.low) / span) * 100)) : 50;
    return (
      <div class="draft panel">
        <div class="recog">
          <span class="ai-mark" />
          <div>
            <b>{draft.object}</b>
            <span>
              {draft.source === 'claude'
                ? `Riconosciuto ${photos.length ? `da ${photos.length} foto` : 'dal testo'} · affidabilità ${Math.round(draft.confidence * 100)}%`
                : 'Bozza dal testo, senza AI'}
            </span>
          </div>
        </div>

        {draft.warnings.length > 0 && (
          <ul class="warn">
            {draft.warnings.map((w) => (
              <li>{w}</li>
            ))}
          </ul>
        )}

        <label class="fld">
          <span class="label"><span class="ai-mark sm" />Titolo</span>
          <input id="draft-title" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} maxLength={80} />
        </label>

        <div class="row">
          <div class="fld">
            <span class="label"><span class="ai-mark sm" />Categoria</span>
            <p>{getCategory(draft.category).name}</p>
          </div>
          <div class="fld">
            <span class="label"><span class="ai-mark sm" />Condizione</span>
            <p>{CONDITION_LABEL[draft.condition]}</p>
            {draft.conditionNote && <small>{draft.conditionNote}</small>}
          </div>
        </div>

        <label class="fld">
          <span class="label"><span class="ai-mark sm" />Descrizione</span>
          <textarea id="draft-description" rows={4} value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
        </label>

        {draft.attributes.length > 0 && (
          <div class="fld">
            <span class="label"><span class="ai-mark sm" />Dettagli</span>
            <dl class="attrs">
              {draft.attributes.map((a) => (
                <div>
                  <dt>{a.name}</dt>
                  <dd>{a.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div class="fld">
          <span class="label"><span class="ai-mark sm" />Parole chiave</span>
          <div class="chips">
            {draft.tags.map((t) => (
              <span class="chip">{t}</span>
            ))}
          </div>
        </div>

        <div class="fld">
          <span class="label"><span class="ai-mark sm" />Prezzo</span>
          {p ? (
            <div class="pband">
              <label class="pb-input">
                <span>CHF</span>
                <input id="draft-price" inputMode="numeric" value={price} onInput={(e) => setPrice((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))} />
              </label>
              <div class="pb-track">
                <span class="pb-range" />
                <span class="pb-dot" style={{ left: `${pos}%` }} />
              </div>
              <div class="pb-scale mono">
                <span>{formatChf(p.low)}</span>
                <span>{formatChf(p.high)}</span>
              </div>
              <small>
                Su {p.comparables} annunci {p.basis === 'simili' ? 'simili' : 'della stessa categoria'}, di cui {p.soldComparables} venduti.
                {p.confidence === 'bassa' && ' Stima indicativa: ci sono ancora pochi annunci davvero simili.'}
              </small>
            </div>
          ) : (
            <p class="muted">Non ci sono ancora annunci simili per stimare un prezzo.</p>
          )}
        </div>

        <div class="fld">
          <span class="label">Ritiro</span>
          <p>{draft.comune ? `${draft.comune.cap} ${draft.comune.name}` : 'Da indicare'}</p>
        </div>

        {draft.questions.length > 0 && (
          <div class="fld">
            <span class="label">Da completare</span>
            <ul class="questions">
              {draft.questions.map((q) => (
                <li>{q}</li>
              ))}
            </ul>
          </div>
        )}

        <div class="actions">
          <button class="btn primary" type="button" disabled title="La pubblicazione arriva nella Fase 1">
            Pubblica annuncio
          </button>
          <button class="btn" type="button" onClick={restart}>
            Ricomincia
          </button>
        </div>
        <p class="muted small">Pubblicazione, messaggi e offerte arrivano nella Fase 1. Questa bozza resta solo nel prototipo.</p>
      </div>
    );
  }

  return (
    <form class="panel sellform" onSubmit={submit}>
      <div class="fld">
        <span class="label">Foto ({photos.length}/{MAX_PHOTOS})</span>
        <div class="shots">
          {photos.map((p, i) => (
            <div class="shot">
              <img src={p.url} alt={`Foto ${i + 1}`} />
              <button type="button" class="remove" aria-label={`Togli la foto ${i + 1}`} onClick={() => removePhoto(i)}>
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label class="shot add">
              <input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  addFiles(input.files);
                  input.value = '';
                }}
              />
              <span aria-hidden="true">+</span>
              <span class="sr">Aggiungi foto</span>
            </label>
          )}
        </div>
      </div>

      <label class="fld">
        <span class="label">Due righe, se vuoi</span>
        <textarea
          id="notes"
          rows={3}
          maxLength={2000}
          placeholder="Es. bici da corsa usata due stagioni, gomme nuove, un graffio sul telaio"
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        />
      </label>

      <label class="fld">
        <span class="label">Comune di ritiro</span>
        <select id="comune" value={comune} onChange={(e) => setComune((e.target as HTMLSelectElement).value)}>
          <option value="">Scegli il comune</option>
          {comuni.map((c) => (
            <option value={c}>{c}</option>
          ))}
        </select>
      </label>

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      <button class="btn primary big" type="submit" disabled={status === 'working'}>
        {status === 'working' ? (
          <>
            <span class="ai-mark live" /> L'assistente sta guardando le foto…
          </>
        ) : (
          'Prepara la bozza'
        )}
      </button>
    </form>
  );
}
