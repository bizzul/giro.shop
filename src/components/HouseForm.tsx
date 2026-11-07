import { useEffect, useState } from 'preact/hooks';
import { actions } from 'astro:actions';
import type { Box, HouseItem, HouseResult } from '../core/house.ts';
import { CONDITION_LABEL, formatChf } from '../core/format.ts';
import { getCategory } from '../core/categories.ts';
import PhotoManager, { type PhotoItem } from './PhotoManager.tsx';
import ComunePicker from './ComunePicker.tsx';

interface Props {
  signedIn?: boolean;
  /** Con Claude più oggetti per foto; senza, una bozza per foto dal testo scritto sotto. */
  aiOn?: boolean;
  max?: number;
}

/** Una bozza nella lista, con le scelte di chi vende e la foto ritagliata. */
interface Row extends HouseItem {
  key: string;
  include: boolean;
  priceText: string;
  file: File | null;
  preview: string | null;
  state: 'da_pubblicare' | 'pubblico' | 'pubblicato' | 'errore';
  message?: string;
  listingId?: string;
}

/** Ritaglia l'oggetto dalla foto (nel browser); senza riquadro resta la foto intera. */
async function crop(file: File, box: Box | null): Promise<File> {
  if (!box) return file;
  const bitmap = await createImageBitmap(file);
  const sx = Math.round(box.x * bitmap.width);
  const sy = Math.round(box.y * bitmap.height);
  const sw = Math.max(1, Math.round(box.width * bitmap.width));
  const sh = Math.max(1, Math.round(box.height * bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d')?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  return blob ? new File([blob], 'oggetto.jpg', { type: 'image/jpeg' }) : file;
}

export default function HouseForm({ signedIn = false, aiOn = false, max = 10 }: Props) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [comune, setComune] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'publishing' | 'finished'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<Pick<HouseResult, 'source' | 'model' | 'warnings'> | null>(null);

  useEffect(
    () => () => {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      rows.forEach((r) => r.preview && URL.revokeObjectURL(r.preview));
    },
    [],
  );

  const update = (key: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function prepare(event: Event) {
    event.preventDefault();
    setError(null);
    if (!photos.length) return setError('Aggiungi almeno una foto.');
    if (!aiOn) {
      const missing = photos.findIndex((p) => !hints[p.key]?.trim());
      if (missing >= 0) return setError(`Scrivi cos'è sotto la foto ${missing + 1}.`);
    }
    setStatus('working');
    const form = new FormData();
    for (const p of photos) {
      if (p.file) form.append('photos', p.file);
      form.append('hint', hints[p.key] ?? '');
    }
    if (notes.trim()) form.append('notes', notes.trim());
    const { data, error: actionError } = await actions.houseDrafts(form);
    if (actionError || !data) {
      setStatus('idle');
      return setError(actionError?.message ?? 'Qualcosa non ha funzionato. Riprova.');
    }
    if (!data.items.length) {
      setStatus('idle');
      return setError('Non ho trovato oggetti da vendere in queste foto. Prova con foto più vicine agli oggetti.');
    }
    const next: Row[] = [];
    for (const [i, item] of data.items.entries()) {
      const source = photos[item.photo]?.file ?? null;
      const file = source ? await crop(source, item.box).catch(() => source) : null;
      next.push({
        ...item,
        key: `o-${i}`,
        include: true,
        priceText: item.price ? String(item.price.mid) : '',
        file,
        preview: file ? URL.createObjectURL(file) : null,
        state: 'da_pubblicare',
      });
    }
    setRows(next);
    setResult({ source: data.source, model: data.model, warnings: data.warnings });
    setStatus('done');
  }

  async function publishAll() {
    setError(null);
    if (!comune) return setError('Scegli il comune di ritiro.');
    const chosen = rows.filter((r) => r.include && r.state !== 'pubblicato');
    if (!chosen.length) return setError('Scegli almeno un oggetto da pubblicare.');
    const bad = chosen.find((r) => r.title.trim().length < 3 || r.priceText === '');
    if (bad) return setError(`Controlla «${bad.title || 'senza titolo'}»: servono un titolo e un prezzo (0 se lo regali).`);
    setStatus('publishing');
    for (const r of chosen) {
      update(r.key, { state: 'pubblico', message: undefined });
      const form = new FormData();
      form.append('title', r.title.trim());
      form.append('description', r.description.trim());
      form.append('category', r.category);
      form.append('condition', r.condition);
      form.append('price', r.priceText);
      form.append('comune', comune);
      form.append('tags', JSON.stringify(r.tags));
      form.append('attributes', JSON.stringify(r.attributes));
      form.append('aiSource', result?.source ?? 'regole');
      if (result?.model) form.append('aiModel', result.model);
      form.append('aiConfidence', String(r.confidence));
      if (r.file) form.append('photos', r.file);
      // Dopo il ritaglio, anche la foto intera: chi compra vede dove sta l'oggetto
      const whole = photos[r.photo]?.file;
      if (r.box && whole) form.append('photos', whole);
      const { data, error: actionError } = await actions.account.publishListing(form);
      update(r.key, data ? { state: 'pubblicato', listingId: data.id } : { state: 'errore', message: actionError?.message ?? 'Non pubblicato.' });
    }
    setStatus('finished');
  }

  if (status === 'done' || status === 'publishing' || status === 'finished') {
    const chosen = rows.filter((r) => r.include && r.state !== 'pubblicato').length;
    const published = rows.filter((r) => r.state === 'pubblicato').length;
    return (
      <div class="house panel">
        <div class="recog">
          <span class="ai-mark" />
          <div>
            <b>{rows.length === 1 ? '1 oggetto' : `${rows.length} oggetti`} da vendere</b>
            <span>{result?.source === 'claude' ? `Riconosciuti in ${photos.length} foto: controlla titoli e prezzi.` : 'Una bozza per foto, dal testo che hai scritto.'}</span>
          </div>
        </div>
        {result?.warnings.length ? (
          <ul class="warn">
            {result.warnings.map((w) => (
              <li>{w}</li>
            ))}
          </ul>
        ) : null}

        <ul class="house-items">
          {rows.map((r) => (
            <li class={['house-item', !r.include && 'off', r.state === 'pubblicato' && 'done'].filter(Boolean).join(' ')} key={r.key}>
              <label class="house-pick">
                <input
                  type="checkbox"
                  checked={r.include}
                  disabled={r.state === 'pubblicato' || status === 'publishing'}
                  onChange={(e) => update(r.key, { include: (e.target as HTMLInputElement).checked })}
                  aria-label={`Pubblica ${r.title}`}
                />
              </label>
              <span class="house-thumb">{r.preview && <img src={r.preview} alt="" />}</span>
              <div class="house-fields">
                <input
                  class="house-title"
                  value={r.title}
                  maxLength={80}
                  aria-label="Titolo"
                  disabled={r.state === 'pubblicato'}
                  onInput={(e) => update(r.key, { title: (e.target as HTMLInputElement).value })}
                />
                <span class="small muted">
                  {getCategory(r.category).name} · {CONDITION_LABEL[r.condition]}
                  {r.price && ` · simili ${formatChf(r.price.low)}–${formatChf(r.price.high)}`}
                </span>
                {r.description && <span class="small house-desc">{r.description}</span>}
                {r.state === 'pubblicato' && r.listingId && (
                  <a class="small" href={`/annuncio/${r.listingId}`}>
                    Pubblicato: vedi l'annuncio
                  </a>
                )}
                {r.state === 'errore' && <span class="small error-text">{r.message}</span>}
              </div>
              <label class="pb-input house-price">
                <span>CHF</span>
                <input
                  inputMode="numeric"
                  value={r.priceText}
                  aria-label={`Prezzo di ${r.title}`}
                  disabled={r.state === 'pubblicato'}
                  onInput={(e) => update(r.key, { priceText: (e.target as HTMLInputElement).value.replace(/[^\d]/g, '') })}
                />
              </label>
            </li>
          ))}
        </ul>

        <div class="fld">
          <label class="label" for="house-comune">
            Comune di ritiro, per tutti
          </label>
          <ComunePicker id="house-comune" value={comune} onChange={setComune} required />
        </div>

        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {status === 'finished' && published > 0 && (
          <p class="notice" role="status">
            {published === 1 ? 'Pubblicato 1 annuncio' : `Pubblicati ${published} annunci`}: chi li cerca riceve un avviso. Li gestisci da{' '}
            <a href="/miei-annunci">I miei annunci</a>.
          </p>
        )}

        <div class="actions">
          {signedIn ? (
            <button class="btn primary" type="button" onClick={publishAll} disabled={status === 'publishing' || chosen === 0}>
              {status === 'publishing' ? 'Pubblico…' : chosen === 1 ? 'Pubblica 1 annuncio' : `Pubblica ${chosen} annunci`}
            </button>
          ) : (
            <a class="btn primary" href="/accedi?next=/svuota-casa">
              Accedi per pubblicare
            </a>
          )}
        </div>
        <p class="muted small">
          Ogni oggetto diventa un annuncio a sé, online 90 giorni. Pubblicando accetti le <a href="/condizioni">condizioni d'uso</a>.
        </p>
      </div>
    );
  }

  return (
    <form class="panel sellform" onSubmit={prepare}>
      <PhotoManager items={photos} onChange={setPhotos} max={max} />

      {!aiOn && photos.length > 0 && (
        <div class="fld">
          <span class="label">Cos'è, foto per foto</span>
          <ol class="house-hints">
            {photos.map((p, i) => (
              <li key={p.key}>
                <img src={p.url} alt="" />
                <input
                  aria-label={`Cos'è nella foto ${i + 1}`}
                  placeholder="Es. divano a tre posti in pelle, qualche graffio"
                  value={hints[p.key] ?? ''}
                  onInput={(e) => setHints({ ...hints, [p.key]: (e.target as HTMLInputElement).value })}
                />
              </li>
            ))}
          </ol>
        </div>
      )}

      <label class="fld">
        <span class="label">Due righe, se vuoi</span>
        <textarea
          rows={2}
          maxLength={2000}
          placeholder="Es. trasloco a fine mese, tutto da ritirare in cantina"
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        />
      </label>

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      <button class="btn primary big" type="submit" disabled={status === 'working'}>
        {status === 'working' ? (
          <>
            <span class="ai-mark live" /> {aiOn ? 'Cerco gli oggetti nelle foto…' : 'Preparo le bozze…'}
          </>
        ) : (
          'Prepara le bozze'
        )}
      </button>
    </form>
  );
}
