import { isInputError } from 'astro:actions';
import { toast } from './toast.ts';

/**
 * Salvataggio senza bottone "Salva", nel browser:
 * - campi di testo: quando esci dal campo (focusout), se il valore è cambiato;
 * - caselle, menu e scelte: appena cambiano;
 * - Invio in un campo di testo: subito;
 * - altri pezzi del modulo (es. le foto) chiedono un salvataggio con l'evento "autosave:request".
 * Un salvataggio alla volta, nell'ordine; ogni esito arriva come notifica toast.
 */

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type SaveResult = { data?: unknown; error?: unknown };

export interface AutosaveOptions {
  /** Manda il modulo al server, di solito un'Astro Action chiamata dal browser. */
  save: (form: FormData) => Promise<SaveResult>;
  /** Prepara il modulo prima dell'invio; un testo vuol dire "non si può salvare" e diventa la notifica. */
  prepare?: () => string | null;
  /** Dopo un salvataggio riuscito, con la risposta del server. */
  saved?: (data: unknown) => void;
  /** Testo della notifica; di base "Salvato · <nome del campo>". */
  message?: (label: string, data: unknown) => string;
}

const TEXTUAL = /^(text|search|email|tel|url|number|password|)$/;

function isField(el: Element | null): el is Field {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function valueOf(el: Field): string {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? String(el.checked) : el.value;
}

/** Il nome del campo come lo vede la persona: l'etichetta, senza "(CHF)" e simili. */
function labelOf(el: Element): string {
  const label = el.closest('label') ?? (el.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`) : null);
  const text =
    label?.querySelector('.label')?.textContent ??
    label?.querySelector('span')?.textContent ??
    (label?.classList.contains('label') ? label.textContent : null) ??
    el.getAttribute('aria-label') ??
    '';
  return text.replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim() || 'modifiche';
}

function errorText(error: unknown): string {
  if (isInputError(error)) return Object.values(error.fields).flat().join(' ') || 'Controlla i campi.';
  return (error as { message?: string })?.message ?? 'Qualcosa non ha funzionato.';
}

export function autosave(form: HTMLFormElement, options: AutosaveOptions) {
  const fields = () =>
    [...form.elements].filter(
      (el): el is Field => isField(el) && Boolean(el.name) && el.type !== 'hidden' && el.type !== 'file' && el.type !== 'submit' && !el.disabled,
    );
  let saved = new Map(fields().map((f) => [f.name, valueOf(f)]));
  const dirty = (f: Field) => saved.get(f.name) !== valueOf(f);

  const labels = new Set<string>();
  let running: Promise<void> | null = null;
  let again = false;

  async function run(): Promise<void> {
    const named = [...labels];
    labels.clear();
    const problem = options.prepare?.();
    if (problem) {
      toast(problem, 'error');
      return;
    }
    const invalid = fields().find((f) => !f.checkValidity());
    if (invalid) {
      invalid.setAttribute('aria-invalid', 'true');
      toast(`${labelOf(invalid)}: ${invalid.validationMessage}`, 'error');
      return;
    }
    const snapshot = new Map(fields().map((f) => [f.name, valueOf(f)]));
    form.setAttribute('aria-busy', 'true');
    let result: SaveResult;
    try {
      result = await options.save(new FormData(form));
    } catch {
      result = { error: { message: 'Connessione assente: riprova quando sei online.' } };
    }
    form.removeAttribute('aria-busy');
    if (result.error) {
      toast(`Non salvato: ${errorText(result.error)}`, 'error');
      return;
    }
    saved = snapshot;
    for (const f of fields()) f.removeAttribute('aria-invalid');
    options.saved?.(result.data);
    const label = named.length === 1 ? named[0] : 'modifiche';
    toast(options.message?.(label, result.data) ?? `Salvato · ${label}`);
  }

  function request(label: string) {
    labels.add(label);
    if (running) {
      again = true;
      return;
    }
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        request(labels.values().next().value ?? 'modifiche');
      }
    });
  }

  // Testo: all'uscita dal campo. Il nuovo fuoco può essere nel modulo stesso o fuori.
  form.addEventListener('focusout', (event) => {
    const el = event.target as Element;
    // Campi senza nome (ricerca dentro un menu, parola chiave in scrittura) non vanno nel modulo: li salva il loro componente
    if (!isField(el) || !el.name || !(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXTUAL.test(el.type)))) return;
    if (dirty(el)) request(labelOf(el));
  });
  // Caselle, menu e scelte: subito
  form.addEventListener('change', (event) => {
    const el = event.target as Element;
    if (!isField(el) || !el.name) return;
    if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))) {
      if (dirty(el)) request(labelOf(el));
    }
  });
  // Invio in un campo di testo: si salva senza ricaricare la pagina
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const active = document.activeElement;
    request(isField(active) ? labelOf(active) : 'modifiche');
  });
  // Altri pezzi del modulo (foto) chiedono di salvare
  form.addEventListener('autosave:request', (event) => request((event as CustomEvent<{ label?: string }>).detail?.label ?? 'modifiche'));

  /** Salva quello che manca e aspetta la fine (prima di lasciare la pagina). */
  async function flush(): Promise<void> {
    const pending = fields().filter(dirty);
    if (pending.length) request(labelOf(pending[0]));
    while (running) await running;
  }

  // Lasciare la pagina con un salvataggio in corso: il browser chiede conferma
  window.addEventListener('beforeunload', (event) => {
    if (running || fields().some(dirty)) event.preventDefault();
  });
  // I link segnati aspettano il salvataggio prima di partire
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-autosave-flush]')) {
    link.addEventListener('click', async (event) => {
      if (!running && !fields().some(dirty)) return;
      event.preventDefault();
      await flush();
      location.href = link.href;
    });
  }

  return { request, flush };
}
