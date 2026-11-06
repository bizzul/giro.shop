import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalize, stem, tokenMatches } from '../core/text.ts';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Riga breve sotto il nome (es. cosa vuol dire "Buono"). */
  description?: string;
  /** Altre parole che la trovano, come [radice, etichetta]: "divano" trova Arredamento · Divani. */
  keywords?: Array<[string, string]>;
  /** Disegno dell'icona (viewBox 64×64, solo tratto), vedi src/lib/category-icons.ts. */
  icon?: string;
}

interface Props {
  /** Id del bottone; l'etichetta del campo lo indica con aria-labelledby. */
  id: string;
  /** Nome del campo nel modulo (campo nascosto con il valore scelto). */
  name: string;
  /** Id dell'etichetta visibile del campo. */
  labelledBy: string;
  /** Nome del campo nelle notifiche di salvataggio ("Salvato · Categoria"). */
  label: string;
  options: ComboboxOption[];
  initial: string;
  placeholder?: string;
  searchPlaceholder?: string;
  empty?: string;
  /** Nella pagina di modifica: scegliere salva subito. */
  autosave?: boolean;
}

interface Match {
  option: ComboboxOption;
  /** La parola chiave che l'ha trovata, se non è il nome. */
  via?: string;
  rank: number;
}

/** La parola scritta corrisponde a una parola chiave? Per radice ("divano" → divan) o per inizio dell'etichetta. */
function keywordHit([root, label]: [string, string], q: string): boolean {
  const words = normalize(label).split(' ');
  const qs = stem(q);
  if (words.some((w) => w.startsWith(q) || w.startsWith(qs))) return true;
  const r = normalize(root);
  return q.includes(' ') ? q.startsWith(r) : tokenMatches(q, r);
}

function filter(options: ComboboxOption[], query: string): Match[] {
  const q = normalize(query);
  if (!q) return options.map((option) => ({ option, rank: 0 }));
  const out: Match[] = [];
  for (const option of options) {
    const label = normalize(option.label);
    if (label.startsWith(q) || label.includes(` ${q}`)) out.push({ option, rank: 0 });
    else if (label.includes(q)) out.push({ option, rank: 1 });
    else {
      const hit = option.keywords?.find((k) => keywordHit(k, q));
      // "bicicletta" trova Bici: la parola chiave si mostra solo se dice qualcosa in più del nome
      if (hit) out.push({ option, via: normalize(hit[1]) === label ? undefined : hit[1], rank: 2 });
      else if (option.description && normalize(option.description).includes(q)) out.push({ option, rank: 3 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function Icon({ d }: { d: string }) {
  return (
    <svg class="cbx-ico" viewBox="0 0 64 64" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * Menu a tendina con ricerca, sul modello del Combobox di shadcn/ui (Popover + Command):
 * un bottone mostra la scelta; aperto, in cima c'è un campo per cercare e sotto l'elenco con la spunta.
 * Frecce per muoversi, Invio per scegliere, Esc per chiudere. Il valore viaggia in un campo nascosto.
 */
export default function Combobox({
  id,
  name,
  labelledBy,
  label,
  options,
  initial,
  placeholder = 'Scegli…',
  searchPlaceholder = 'Cerca…',
  empty = 'Nessun risultato.',
  autosave,
}: Props) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const listId = `${useId()}-elenco`;

  const selected = options.find((o) => o.value === value);
  const results = useMemo(() => filter(options, query), [options, query]);

  /** Apre l'elenco; con un testo (lettera scritta sul bottone chiuso) parte già la ricerca. */
  const show = (typed = '') => {
    setQuery(typed);
    setActive(typed ? 0 : Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const choose = (option: ComboboxOption) => {
    close(true);
    if (option.value === value) return;
    setValue(option.value);
    if (hidden.current) hidden.current.value = option.value;
    if (autosave) {
      const form = hidden.current?.form;
      setTimeout(() => form?.dispatchEvent(new CustomEvent('autosave:request', { detail: { label } })), 0);
    }
  };

  // Il fuoco va subito nella ricerca (prima del disegno), così le lettere scritte dopo il clic non si perdono
  useLayoutEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Un tocco fuori chiude, come un popover
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : Math.max(0, results.length - 1));
    } else if (event.key === 'Enter') {
      // Invio sceglie, non invia il modulo
      event.preventDefault();
      const pick = results[active] ?? results[0];
      if (pick) choose(pick.option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={root}
      class="cbx"
      onFocusOut={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input ref={hidden} type="hidden" name={name} value={value} />
      <button
        ref={trigger}
        id={id}
        type="button"
        class="cbx-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelledBy} ${id}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            // Scrivere sul bottone chiuso apre e cerca
            event.preventDefault();
            show(event.key);
          }
        }}
      >
        {selected?.icon && <Icon d={selected.icon} />}
        <span class={selected ? 'cbx-value' : 'cbx-value cbx-placeholder'}>{selected?.label ?? placeholder}</span>
        <svg class="cbx-chevrons" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div class="cbx-pop">
          <div class="cbx-search">
            <svg class="cbx-lens" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              ref={search}
              type="text"
              role="combobox"
              aria-label={searchPlaceholder}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
              autocomplete="off"
              spellcheck={false}
              placeholder={searchPlaceholder}
              value={query}
              onInput={(e) => {
                setQuery((e.target as HTMLInputElement).value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </div>
          <ul ref={list} class="cbx-list" id={listId} role="listbox" aria-labelledby={labelledBy}>
            {results.length === 0 ? (
              <li class="cbx-empty" role="presentation">
                {empty}
              </li>
            ) : (
              results.map(({ option, via }, i) => (
                <li
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={option.value === value}
                  class={i === active ? 'is-active' : undefined}
                  // Il tocco non toglie il fuoco al campo di ricerca prima della scelta
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => choose(option)}
                >
                  {option.icon && <Icon d={option.icon} />}
                  <span class="cbx-text">
                    <span class="cbx-name">
                      {option.label}
                      {via && <span class="cbx-via"> · {via}</span>}
                    </span>
                    {option.description && <span class="cbx-desc">{option.description}</span>}
                  </span>
                  <svg class="cbx-check" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
