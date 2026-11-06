import { useEffect, useRef, useState } from 'preact/hooks';
import PhotoManager, { type PhotoItem } from './PhotoManager.tsx';

interface Props {
  /** Foto già salvate, nell'ordine attuale (la prima è la copertina). */
  initial: Array<{ path: string; url: string }>;
}

/**
 * I riquadri delle foto dentro un form normale (pagina di modifica).
 * Al momento dell'invio scrive nel form l'ordine scelto ("e:<percorso>" per le foto salvate,
 * "n:<indice>" per le nuove) e mette i file nuovi nel campo file. Lo fa solo all'invio e partendo
 * dallo stato dei riquadri, così valori vecchi ripristinati dal browser (ricarica, indietro) non contano.
 */
export default function PhotoField({ initial }: Props) {
  const [items, setItems] = useState<PhotoItem[]>(initial.map((p) => ({ key: `e:${p.path}`, url: p.url })));
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(items);
  latest.current = items;

  useEffect(() => {
    if (items.length) setMessage(null);
  }, [items]);

  useEffect(() => {
    const input = fileInput.current;
    const form = input?.form;
    if (!input || !form) return;
    // Un eventuale file ripristinato dal browser non deve partire
    input.value = '';

    const onSubmit = (event: SubmitEvent) => {
      const list = latest.current;
      if (list.length === 0) {
        event.preventDefault();
        setMessage("Serve almeno una foto: la prima è la copertina dell'annuncio.");
        return;
      }
      const fresh = list.filter((i) => i.file);
      const transfer = new DataTransfer();
      for (const item of fresh) transfer.items.add(item.file as File);
      input.files = transfer.files;

      form.querySelectorAll('input[data-photo-order]').forEach((n) => n.remove());
      for (const item of list) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'order';
        hidden.value = item.file ? `n:${fresh.indexOf(item)}` : item.key;
        hidden.dataset.photoOrder = '';
        form.append(hidden);
      }
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  return (
    <>
      <PhotoManager items={items} onChange={setItems} keepOne message={message} />
      <input ref={fileInput} type="file" name="photos" multiple hidden tabIndex={-1} aria-hidden="true" autocomplete="off" />
    </>
  );
}
