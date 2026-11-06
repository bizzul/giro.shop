import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { resolveComune, searchComuni } from '../core/comuni.ts';
import type { Comune } from '../core/types.ts';
import { toast } from '../lib/toast.ts';
import '../styles/comune-picker.css';

/** Chi usa il campo da fuori (script di pagina) lo imposta con questo evento sull'input: detail = nome del comune o ''. */
export const SET_EVENT = 'comune:set';
/** Quando la persona sceglie un comune dall'elenco (clic o Invio), sull'input: detail = { name }. */
export const PICK_EVENT = 'comune:pick';

interface Props {
  id: string;
  /** Nome del campo nel modulo (pagina di modifica); nei moduli Preact si usa value/onChange. */
  name?: string;
  /** Valore controllato (nome del comune, '' se nessuno). */
  value?: string;
  /** Valore iniziale se non controllato. */
  initial?: string;
  onChange?: (name: string) => void;
  required?: boolean;
  /** Nella pagina di modifica: scegliere un comune salva subito, come un menu. */
  autosave?: boolean;
}

/**
 * Comune di ritiro ricercabile: si scrive e l'elenco si restringe (nome, frazione o CAP, senza accenti).
 * Frecce per scegliere, Invio per confermare, Esc per tornare al comune di prima.
 * Uscendo dal campo con un testo che non è un comune, torna al comune di prima e lo dice.
 */
export default function ComunePicker({ id, name, value, initial = '', onChange, required, autosave }: Props) {
  const [chosen, setChosen] = useState(value ?? initial);
  const [text, setText] = useState(value ?? initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const state = useRef({ text, chosen });
  state.current = { text, chosen };
  // Com'era l'elenco quando è cominciato il clic: un secondo clic sul campo lo chiude, come un menu
  const wasOpen = useRef(false);
  const listId = `${id}-elenco`;

  // Valore controllato dal modulo che lo contiene (es. la bozza di Vendi)
  useEffect(() => {
    if (value === undefined) return;
    setChosen(value);
    setText(value);
  }, [value]);

  // Con il testo uguale al comune scelto si vede tutto l'elenco, altrimenti solo chi corrisponde
  const results = useMemo(() => searchComuni(text === chosen ? '' : text), [text, chosen]);

  const choose = (c: Comune | null, save: boolean) => {
    const nameValue = c?.name ?? '';
    if (input.current) input.current.value = nameValue;
    setChosen(nameValue);
    setText(nameValue);
    setOpen(false);
    setActive(-1);
    onChange?.(nameValue);
    if (save) input.current?.dispatchEvent(new CustomEvent(PICK_EVENT, { bubbles: true, detail: { name: nameValue } }));
    if (save && autosave) {
      const form = input.current?.form;
      setTimeout(() => form?.dispatchEvent(new CustomEvent('autosave:request', { detail: { label: 'Comune di ritiro' } })), 0);
    }
  };

  // Impostato da fuori (es. "Usa la mia posizione"): non conta come scelta della persona
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const set = (event: Event) => {
      const wanted = (event as CustomEvent<string>).detail ?? '';
      choose(resolveComune(wanted) ?? null, false);
    };
    el.addEventListener(SET_EVENT, set);
    return () => el.removeEventListener(SET_EVENT, set);
  }, []);

  // Uscendo dal campo: un comune vero, oppure si torna a quello di prima. Gira prima del salvataggio automatico del modulo.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const commit = () => {
      setOpen(false);
      const { text: typed, chosen: before } = state.current;
      if (typed === before) return;
      const matches = searchComuni(typed);
      const found = resolveComune(typed) ?? (matches.length === 1 ? matches[0] : undefined);
      if (found) {
        choose(found, false);
      } else if (!typed.trim() && !required) {
        choose(null, false);
      } else {
        el.value = before;
        setText(before);
        if (typed.trim()) toast(`«${typed.trim()}» non è un comune dell'elenco: scegline uno.`, 'error');
      }
    };
    el.addEventListener('focusout', commit);
    return () => el.removeEventListener('focusout', commit);
  }, [required]);

  useEffect(() => {
    if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + results.length) % Math.max(1, results.length));
    } else if (event.key === 'Enter') {
      // Invio sceglie il comune evidenziato (o l'unico rimasto), senza inviare il modulo
      const pick = results[active] ?? (results.length === 1 ? results[0] : undefined);
      if (open && pick) {
        event.preventDefault();
        choose(pick, true);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setText(state.current.chosen);
    }
  };

  const highlight = (label: string) => {
    if (text === chosen || !text.trim()) return label;
    const i = label.toLowerCase().indexOf(text.trim().toLowerCase());
    if (i < 0) return label;
    return (
      <>
        {label.slice(0, i)}
        <b>{label.slice(i, i + text.trim().length)}</b>
        {label.slice(i + text.trim().length)}
      </>
    );
  };

  return (
    <div class="comune-picker">
      <input
        ref={input}
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autocomplete="off"
        spellcheck={false}
        required={required}
        placeholder="Scrivi il comune o il CAP"
        value={text}
        onFocus={() => setOpen(true)}
        onPointerDown={() => (wasOpen.current = open)}
        onClick={() => {
          // Mentre si scrive il clic sposta solo il cursore; altrimenti apre e chiude
          if (wasOpen.current && text === chosen) setOpen(false);
          else setOpen(true);
        }}
        onInput={(e) => {
          setText((e.target as HTMLInputElement).value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        class="cp-toggle"
        tabIndex={-1}
        aria-hidden="true"
        // Il fuoco resta nel campo: la freccetta apre e chiude l'elenco
        onPointerDown={(e) => {
          e.preventDefault();
          input.current?.focus();
          setOpen((o) => !o);
        }}
      >
        <svg class="cp-chevron" viewBox="0 0 12 12">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <ul ref={list} class="cp-list" id={listId} role="listbox" aria-label="Comuni">
          {results.length === 0 ? (
            <li class="cp-empty" role="presentation">
              Nessun comune trovato
            </li>
          ) : (
            results.map((c, i) => (
              <li
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active || (active < 0 && c.name === chosen)}
                class={c.name === chosen ? 'is-chosen' : undefined}
                // Il tocco non deve togliere il fuoco al campo prima della scelta
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(c, true)}
              >
                <span class="cp-name">{highlight(c.name)}</span>
                <span class="cp-meta">
                  {c.cap} · {c.district}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
