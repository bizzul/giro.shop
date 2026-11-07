import { useEffect, useState } from 'preact/hooks';
import { actions } from 'astro:actions';
import type { Draft } from '../core/draft.ts';
import type { Demand } from '../core/demand.ts';
import { CONDITION_LABEL, formatChf } from '../core/format.ts';
import { getCategory } from '../core/categories.ts';
import PhotoManager, { type PhotoItem } from './PhotoManager.tsx';
import ComunePicker from './ComunePicker.tsx';
import { useAutoComune } from '../lib/auto-comune.ts';
import { clearSellDraft, loadSellDraft, saveSellDraft } from '../lib/draft-store.ts';

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
  // "Importa da un altro sito": link di un proprio annuncio su tutti.ch, anibis.ch o ricardo.ch
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Se il sito blocca il nostro server: si incolla il testo e la bozza la prepara l'assistente
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState('');
  // Comune di ritiro dalle coordinate della foto o, se non ci sono, dalla posizione del telefono
  const auto = useAutoComune(comune || draft?.comune?.name || '', setComune);
  const changePhotos = (next: PhotoItem[]) => {
    setPhotos(next);
    auto.photosChanged(next);
  };

  const [resumed, setResumed] = useState(false);
  // Primo annuncio senza account: email, codice a 6 cifre nella stessa pagina, poi si pubblica
  const [authed, setAuthed] = useState(signedIn);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // Bozza salvata prima di andare ad accedere: si riprende da dove era
  useEffect(() => {
    loadSellDraft().then((saved) => {
      if (!saved) return;
      setPhotos(saved.photos.map((p, i) => ({ key: `ripresa-${i}`, url: URL.createObjectURL(p.file), file: p.file, ...(p.gps ? { gps: p.gps } : {}) })));
      setDraft(saved.draft);
      setTitle(saved.title);
      setDescription(saved.description);
      setPrice(saved.price);
      setComune(saved.comune);
      setShipping(saved.shipping);
      setShippingChf(saved.shippingChf);
      setStatus('done');
      setResumed(true);
    });
  }, []);

  /** La bozza nel browser (IndexedDB): se si entra con il link o dalla pagina di accesso, al ritorno si ritrova. */
  async function keepDraft() {
    if (!draft) return;
    await saveSellDraft({
      draft,
      title,
      description,
      price,
      comune: comune || draft.comune?.name || '',
      shipping,
      shippingChf,
      photos: photos.flatMap((p) => (p.file ? [{ file: p.file, ...(p.gps ? { gps: p.gps } : {}) }] : [])),
    });
  }

  /** Va alla pagina di accesso (link o passkey) tenendo la bozza. */
  async function signInKeepingDraft(event: Event) {
    if (!draft) return;
    event.preventDefault();
    await keepDraft();
    location.href = '/accedi?next=/vendi';
  }

  /** Manda l'email con il codice (e il link, che riporta qui con la bozza). Se l'account non c'è, nasce adesso. */
  async function sendCode() {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Scrivi un indirizzo email valido.');
    setChecking(true);
    await keepDraft();
    const form = new FormData();
    form.append('email', email.trim());
    form.append('next', '/vendi');
    const { error: sendError } = await actions.account.sendMagicLink(form);
    setChecking(false);
    if (sendError) return setError(sendError.message);
    setCodeSent(true);
  }

  /** Controlla il codice: la sessione si apre in questa pagina e l'annuncio si pubblica subito. */
  async function confirmAndPublish() {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('Il codice ha 6 cifre.');
    setChecking(true);
    const { error: codeError } = await actions.account.verifyCode({ email: email.trim(), code: code.trim(), next: '/vendi' });
    setChecking(false);
    if (codeError) return setError(codeError.message);
    setAuthed(true);
    await publish();
  }

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

  /** Legge il proprio annuncio da un altro portale e apre la bozza già compilata, foto comprese. */
  async function importFromSite(event: Event) {
    event.preventDefault();
    setImportError(null);
    setPasteMode(false);
    if (!importUrl.trim()) return setImportError("Incolla il link del tuo annuncio.");
    setImporting(true);
    const { data, error: actionError } = await actions.importListing({ url: importUrl.trim() });
    setImporting(false);
    if (actionError || !data) {
      setImportError(actionError?.message ?? 'Importazione non riuscita. Riprova.');
      // Sito che blocca o pagina illeggibile: resta la strada del testo incollato
      if (actionError && (actionError.code === 'FAILED_DEPENDENCY' || actionError.code === 'UNPROCESSABLE_CONTENT')) setPasteMode(true);
      return;
    }
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    const files = data.photos.map((p, i) => {
      const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
      return new File([bytes], `importata-${i + 1}.jpg`, { type: p.type });
    });
    setPhotos(files.map((file, i) => ({ key: `importata-${Date.now()}-${i}`, url: URL.createObjectURL(file), file })));
    setDraft(data.draft);
    setTitle(data.draft.title);
    setDescription(data.draft.description);
    setPrice(data.priceChf != null ? String(data.priceChf) : data.draft.price ? String(data.draft.price.mid) : '');
    if (data.draft.comune) setComune(data.draft.comune.name);
    setImportOpen(false);
    setStatus('done');
  }

  /** Fallback: il testo incollato va nelle "due righe" e l'assistente prepara la bozza come sempre. */
  function usePasted() {
    const text = pasted.trim();
    if (!text) return setImportError("Incolla il testo dell'annuncio.");
    setNotes([notes.trim(), text].filter(Boolean).join('\n\n').slice(0, 2000));
    setPasted('');
    setPasteMode(false);
    setImportError(null);
    setImportOpen(false);
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
    await clearSellDraft();
    // Auto, moto e affitti: prima si paga la pubblicazione
    location.href = data.payUrl ?? `/annuncio/${data.id}`;
  }

  function restart() {
    void clearSellDraft();
    setResumed(false);
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
              {draft.importedFrom
                ? `Importato da ${draft.importedFrom}: controlla ogni campo prima di pubblicare`
                : draft.source === 'claude'
                ? `Riconosciuto ${photos.length ? `da ${photos.length} foto` : 'dal testo'} · affidabilità ${Math.round(draft.confidence * 100)}%`
                : 'Bozza dal testo, senza AI'}
            </span>
          </div>
        </div>

        {resumed && (
          <p class="notice" role="status">
            {signedIn ? 'Bozza ripresa: controlla e pubblica.' : 'Bozza ripresa da questo browser.'}
          </p>
        )}

        <PhotoManager
          items={photos}
          onChange={changePhotos}
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
          <ComunePicker id="draft-comune" value={comune || draft.comune?.name || ''} onChange={auto.choose} required />
          <small role="status">{auto.note}</small>
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

        {!authed && (
          <div class="fld code-step">
            {!codeSent ? (
              <>
                <label class="label" for="publish-email">
                  La tua email, per pubblicare
                </label>
                <input id="publish-email" type="email" autoComplete="email" inputMode="email" placeholder="nome@esempio.ch" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
                <small>
                  Ti mandiamo un codice di 6 cifre, niente password. Hai già un account?{' '}
                  <a href="/accedi?next=/vendi" onClick={signInKeepingDraft}>
                    Accedi con il link o la passkey
                  </a>
                  .
                </small>
              </>
            ) : (
              <>
                <label class="label" for="publish-code">
                  Codice
                </label>
                <input id="publish-code" class="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))} />
                <small>
                  Ti abbiamo scritto a <b>{email}</b>: scrivi il codice, oppure apri il link nell'email (la bozza resta salvata).{' '}
                  <button type="button" class="link-button" onClick={() => setCodeSent(false)}>
                    Cambia email
                  </button>
                </small>
              </>
            )}
          </div>
        )}

        <div class="actions">
          {authed ? (
            <button class="btn primary" type="button" onClick={publish} disabled={publishing || photos.length === 0}>
              {publishing ? 'Pubblico…' : 'Pubblica annuncio'}
            </button>
          ) : !codeSent ? (
            <button class="btn primary" type="button" onClick={sendCode} disabled={checking}>
              {checking ? 'Mando il codice…' : 'Mandami il codice'}
            </button>
          ) : (
            <button class="btn primary" type="button" onClick={confirmAndPublish} disabled={checking || publishing || photos.length === 0}>
              {checking || publishing ? 'Pubblico…' : 'Conferma e pubblica'}
            </button>
          )}
          <button class="btn" type="button" onClick={restart} disabled={publishing}>
            Ricomincia
          </button>
        </div>
        <p class="muted small">
          {authed
            ? "Dopo la pubblicazione l'annuncio resta online 90 giorni. Lo gestisci da I miei annunci."
            : "Per pubblicare serve un account: nasce con l'email e il codice, senza password. Subito dopo puoi salvare una passkey."}{' '}
          Pubblicando accetti le <a href="/condizioni">condizioni d'uso</a>, comprese le <a href="/condizioni#regole">regole della comunità</a>.
        </p>
      </div>
    );
  }

  return (
    <form class="panel sellform" onSubmit={submit}>
      <div class="import">
        {!importOpen ? (
          <button type="button" class="btn import-open" onClick={() => setImportOpen(true)}>
            Importa da un altro sito
          </button>
        ) : (
          <div class="import-box" role="group" aria-labelledby="import-label">
            <label class="label" id="import-label" for="import-url">
              Link del tuo annuncio su tutti.ch, anibis.ch o ricardo.ch
            </label>
            <div class="import-row">
              <input
                id="import-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://www.tutti.ch/it/vi/…"
                value={importUrl}
                onInput={(e) => setImportUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && importFromSite(e)}
              />
              <button type="button" class="btn primary" onClick={importFromSite} disabled={importing}>
                {importing ? 'Importo…' : 'Importa'}
              </button>
            </div>
            <small>
              Solo annunci tuoi, uno alla volta. Prendiamo titolo, testo, prezzo, luogo e foto; poi controlli tu e pubblichi.{' '}
              <button type="button" class="link-button" onClick={() => { setImportOpen(false); setImportError(null); setPasteMode(false); }}>
                Chiudi
              </button>
            </small>
            {importError && (
              <p class="error" role="alert">
                {importError}
              </p>
            )}
            {pasteMode && (
              <div class="fld">
                <label class="label" for="import-text">
                  Incolla qui il testo del tuo annuncio
                </label>
                <textarea id="import-text" rows={5} maxLength={2000} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} />
                <small>Copia titolo, descrizione e prezzo dalla pagina dell'annuncio. Poi aggiungi qui sotto le foto: la bozza la prepara l'assistente.</small>
                <button type="button" class="btn" onClick={usePasted}>
                  Usa questo testo
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <PhotoManager items={photos} onChange={changePhotos} />

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
        <ComunePicker id="comune" value={comune} onChange={auto.choose} />
        <small role="status">{auto.note}</small>
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
