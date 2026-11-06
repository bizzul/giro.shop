import { useEffect, useRef, useState } from 'preact/hooks';
import { normalize, stem } from '../core/text.ts';
import { toast } from '../lib/toast.ts';

interface Props {
  /** Id del campo dove si scrive; l'etichetta lo indica con for. */
  id: string;
  /** Nome del campo nel modulo: le parole separate da virgole, come le legge il server. */
  name: string;
  initial: string[];
  /** Parole consigliate, le migliori prima (src/core/tags.ts). */
  suggestions: string[];
  max?: number;
  /** Nella pagina di modifica: ogni aggiunta o tolta salva subito. */
  autosave?: boolean;
}

const MAX_LENGTH = 30;
const key = (tag: string) => normalize(tag).split(' ').map(stem).join(' ');
const clean = (tag: string) => tag.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_LENGTH);

/**
 * Parole chiave come badge: si scrive e Invio (o la virgola) aggiunge, la × toglie,
 * Backspace nel campo vuoto toglie l'ultima. Sotto, le parole consigliate si aggiungono con un tocco.
 */
export default function TagInput({ id, name, initial, suggestions, max = 12, autosave }: Props) {
  const [tags, setTags] = useState(initial.map(clean).filter(Boolean));
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const changed = useRef(false);
  const full = tags.length >= max;

  const has = (list: string[], tag: string) => list.some((t) => key(t) === key(tag));
  const offered = suggestions.filter((s) => !has(tags, s)).slice(0, 8);

  // Dopo un cambio della persona: il campo nascosto si aggiorna e si salva
  useEffect(() => {
    if (hidden.current) hidden.current.value = tags.join(', ');
    if (!changed.current) return;
    changed.current = false;
    if (autosave) hidden.current?.form?.dispatchEvent(new CustomEvent('autosave:request', { detail: { label: 'Parole chiave' } }));
  }, [tags]);

  const add = (raw: string[]) => {
    let next = tags;
    for (const tag of raw.map(clean).filter(Boolean)) {
      if (has(next, tag)) continue;
      if (next.length >= max) {
        toast(`Al massimo ${max} parole chiave: togline una per aggiungerne altre.`, 'error');
        break;
      }
      next = [...next, tag];
    }
    if (next !== tags) {
      changed.current = true;
      setTags(next);
    }
  };

  const remove = (tag: string) => {
    changed.current = true;
    setTags(tags.filter((t) => t !== tag));
  };

  const commit = () => {
    if (!text.trim()) return;
    add(text.split(','));
    setText('');
  };

  return (
    <div class="tags-field">
      <input ref={hidden} type="hidden" name={name} value={tags.join(', ')} />
      <div class="tag-box" onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
        {tags.map((tag) => (
          <span class="tag" key={tag}>
            {tag}
            <button type="button" class="tag-x" aria-label={`Togli «${tag}»`} onClick={() => remove(tag)}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          type="text"
          autocomplete="off"
          enterkeyhint="enter"
          maxLength={MAX_LENGTH * 4}
          disabled={full}
          placeholder={full ? `Hai raggiunto ${max} parole` : tags.length ? 'Aggiungi una parola…' : 'Scrivi una parola e premi Invio'}
          aria-describedby={`${id}-aiuto`}
          value={text}
          onInput={(e) => {
            const value = (e.target as HTMLInputElement).value;
            // Con la virgola (anche incollando "a, b, c") le parole finite diventano badge
            if (value.includes(',')) {
              const parts = value.split(',');
              add(parts.slice(0, -1));
              setText(parts.at(-1)?.trimStart() ?? '');
            } else setText(value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !text && tags.length) {
              e.preventDefault();
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={commit}
        />
      </div>
      <small id={`${id}-aiuto`}>
        Aiutano chi cerca a trovare l'annuncio. Invio o virgola per aggiungere · {tags.length}/{max}
      </small>

      {offered.length > 0 && (
        <div class="tag-suggest">
          <span class="tag-suggest-title">Consigliate, dagli annunci simili</span>
          <div class="tag-suggest-list">
            {offered.map((s) => (
              <button type="button" class="tag tag-add" key={s} disabled={full} onClick={() => add([s])} aria-label={`Aggiungi «${s}»`}>
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M6 2.5v7M2.5 6h7" />
                </svg>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
