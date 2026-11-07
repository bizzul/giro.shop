import { useEffect, useState } from 'preact/hooks';
import { actions } from 'astro:actions';
import type { Draft } from '../core/draft.ts';
import type { Demand } from '../core/demand.ts';
import { CONDITION_LABEL, formatChf } from '../core/format.ts';
import { getCategory } from '../core/categories.ts';
import PhotoManager, { type PhotoItem } from './PhotoManager.tsx';
import ComunePicker from './ComunePicker.tsx';

interface Props {
  /** Chi ha fatto l'accesso può pubblicare; gli altri vengono portati all'accesso. */
  signedIn?: boolean;
  /** Testo di partenza (da Cercasi: l'oggetto che qualcuno cerca). */
  initialNotes?: string;
}

export default function SellForm({ signedIn = false, initialNotes = '' }: Props) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [notes, setNotes] = useState(initialNotes);
  const [comune, setComune] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [shippingChf, setShippingChf] = useState('');
  const [demand, setDemand] = useState<Demand | null>(null);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // "Lo cercano in 4": chi ha una ricerca salvata per un oggetto così (serve il comune, per chi cerca vicino a casa)
  const pickupName = comune || draft?.comune?.name || '';
  useEffect(() => {
    if (!draft || !pickupName) return setDemand(null);
    let current = true;
    actions
      .demand({ title: title || draft.title, description, tags: draft.tags, category: draft.category, condition: draft.condition, comune: pickupName, shipping })
      .then(({ data }) => current && setDemand(data ?? null))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [draft, pickupName, shipping]);

  async function submit(event: Event) {
    event.preventDefault();
    setError(null);
    if (!photos.length && !notes.trim()) {
      setError('Aggiungi almeno una foto o due righe di descrizione.');
      return;
    }
    setStatus('working');
    const form = new FormData();
    photos.forEach((p) => p.file && form.append('photos', p.file));
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

  /** Pubblica la bozza così come l'hai modificata, con le foto già ridotte. */
  async function publish() {
    if (!draft) return;
    // Il comune scelto a mano vince su quello riconosciuto dalla bozza
    const pickup = comune || draft.comune?.name || '';
    if (!title.trim()) return setError('Scrivi un titolo.');
    if (price === '') return setError('Indica un prezzo (0 se lo regali).');
    if (!pickup) return setError('Scegli il comune di ritiro.');
    if (!photos.length) return setError("Aggiungi almeno una foto: la prima è la copertina dell'annuncio.");
    setError(null);
    setPublishing(true);
    const form = new FormData();
    form.append('title', title.trim());
    form.append('description', description.trim());
    form.append('category', draft.category);
    form.append('condition', draft.condition);
    form.append('price', price);
    form.append('comune', pickup);
    if (shipping) {
      form.append('shipping', 'on');
      if (shippingChf) form.append('shippingChf', shippingChf);
    }
    form.append('tags', JSON.stringify(draft.tags));
    form.append('attributes', JSON.stringify(draft.attributes));
    form.append('aiSource', draft.source);
    if (draft.model) form.append('aiModel', draft.model);
    form.append('aiConfidence', String(draft.confidence));
    // Nell'ordine dei riquadri: la prima foto è la copertina
    photos.forEach((p) => p.file && form.append('photos', p.file));
    const { data, error: actionError } = await actions.account.publishListing(form);
    if (actionError || !data) {
      setPublishing(false);
      setError(actionError?.message ?? 'Pubblicazione non riuscita. Riprova.');
      return;
    }
    // Auto, moto e affitti: prima si paga la pubblicazione
    location.href = data.payUrl ?? `/annuncio/${data.id}`;
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

        <PhotoManager
          items={photos}
          onChange={setPhotos}
          keepOne={photos.length > 0}
          message={photos.length === 0 ? "Aggiungi almeno una foto per pubblicare: la prima è la copertina." : null}
        />

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
            <>
              <p class="muted">Non ci sono ancora annunci simili per stimare un prezzo.</p>
              <label class="pb-input">
                <span>CHF</span>
                <input id="draft-price" inputMode="numeric" value={price} onInput={(e) => setPrice((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))} />
              </label>
            </>
          )}
        </div>

        {demand && demand.people > 0 && (
          <div class="demand" role="status">
            <b>{demand.people === 1 ? 'Lo cerca 1 persona' : `Lo cercano in ${demand.people}`}</b>
            <span>
              {demand.people === 1 ? 'Una persona ha' : `${demand.people} persone hanno`} una ricerca salvata per un oggetto così: quando pubblichi
              ricevono subito un avviso.
              {demand.budget && ` Budget indicato: da ${formatChf(demand.budget.low)} a ${formatChf(demand.budget.high)}.`}
              {demand.budget && Number(price) > demand.budget.high && ` A ${formatChf(Number(price))} sei sopra il budget di tutti.`}
            </span>
            <a href="/cercasi">Cosa cercano gli altri</a>
          </div>
        )}

        <div class="fld">
          <label class="label" for="draft-comune">
            {draft.comune && !comune && <span class="ai-mark sm" />}Comune di ritiro
          </label>
          <ComunePicker id="draft-comune" value={comune || draft.comune?.name || ''} onChange={setComune} required />
        </div>

        <div class="fld">
          <span class="label">Spedizione</span>
          <label class="check">
            <input type="checkbox" checked={shipping} onChange={(e) => setShipping((e.target as HTMLInputElement).checked)} />
            <span>Si può anche spedire</span>
          </label>
          {shipping && (
            <label class="ship-cost">
              <span>CHF</span>
              <input
                id="draft-shipping"
                inputMode="decimal"
                placeholder="da concordare"
                aria-label="Costo di spedizione in franchi"
                value={shippingChf}
                onInput={(e) => setShippingChf((e.target as HTMLInputElement).value.replace(/[^\d.]/g, ''))}
              />
            </label>
          )}
          <small>Chi cerca «con spedizione» lo trova; il ritiro di persona resta sempre possibile.</small>
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

        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}

        <div class="actions">
          {signedIn ? (
            <button class="btn primary" type="button" onClick={publish} disabled={publishing || photos.length === 0}>
              {publishing ? 'Pubblico…' : 'Pubblica annuncio'}
            </button>
          ) : (
            <a class="btn primary" href="/accedi?next=/vendi">
              Accedi per pubblicare
            </a>
          )}
          <button class="btn" type="button" onClick={restart} disabled={publishing}>
            Ricomincia
          </button>
        </div>
        <p class="muted small">
          {signedIn
            ? "Dopo la pubblicazione l'annuncio resta online 90 giorni. Lo gestisci da I miei annunci."
            : 'Per pubblicare serve un account: entri con un link via email, senza password.'}{' '}
          Pubblicando accetti le <a href="/condizioni">condizioni d'uso</a>, comprese le <a href="/condizioni#regole">regole della comunità</a>.
        </p>
      </div>
    );
  }

  return (
    <form class="panel sellform" onSubmit={submit}>
      <PhotoManager items={photos} onChange={setPhotos} />

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

      <div class="fld">
        <label class="label" for="comune">
          Comune di ritiro
        </label>
        <ComunePicker id="comune" value={comune} onChange={setComune} />
      </div>

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
