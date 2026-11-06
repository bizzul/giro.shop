import { useEffect, useRef, useState } from 'preact/hooks';
import PhotoManager, { type PhotoItem } from './PhotoManager.tsx';

interface Props {
  /** Foto già salvate, nell'ordine attuale (la prima è la copertina). */
  initial: Array<{ path: string; url: string }>;
}

/**
 * I riquadri delle foto dentro il modulo di modifica.
 * Prima di ogni invio (evento "photos:prepare", o "submit" senza salvataggio automatico) scrive nel modulo
 * l'ordine scelto ("e:<percorso>" per le foto salvate, "n:<indice>" per le nuove) e mette i file nuovi nel
 * campo file, partendo dallo stato dei riquadri: valori vecchi ripristinati dal browser non contano.
 * Ogni cambio (aggiunta, tolta, ordine, copertina) chiede un salvataggio ("autosave:request");
 * a salvataggio fatto ("photos:saved") le foto nuove diventano foto salvate e non si rimandano.
 */
export default function PhotoField({ initial }: Props) {
  const [items, setItems] = useState<PhotoItem[]>(initial.map((p) => ({ key: `e:${p.path}`, url: p.url })));
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(items);
  latest.current = items;
  const changedByUser = useRef(false);

  useEffect(() => {
    if (items.length) setMessage(null);
    // Chiede di salvare dopo un cambio fatto dalla persona (non al caricamento, non dopo un salvataggio)
    if (!changedByUser.current) return;
    changedByUser.current = false;
    const form = fileInput.current?.form;
    const timer = setTimeout(() => form?.dispatchEvent(new CustomEvent('autosave:request', { detail: { label: 'Foto' } })), 400);
    return () => clearTimeout(timer);
  }, [items]);

  useEffect(() => {
    const input = fileInput.current;
    const form = input?.form;
    if (!input || !form) return;
    // Un eventuale file ripristinato dal browser non deve partire
    input.value = '';

    /** Scrive ordine e file nuovi nel modulo; false se manca la foto obbligatoria. */
    const prepare = (): boolean => {
      const list = latest.current;
      if (list.length === 0) {
        setMessage("Serve almeno una foto: la prima è la copertina dell'annuncio.");
        form.dataset.photosError = "Serve almeno una foto: la prima è la copertina dell'annuncio.";
        return false;
      }
      delete form.dataset.photosError;
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
      return true;
    };

    const onSubmit = (event: SubmitEvent) => {
      if (!prepare()) event.preventDefault();
    };
    const onPrepare = () => prepare();
    // Dopo il salvataggio: le foto nuove ora sono salvate, con il loro percorso
    const onSaved = (event: Event) => {
      const photos = (event as CustomEvent<Array<{ path: string; url: string }>>).detail;
      if (!Array.isArray(photos)) return;
      for (const item of latest.current) if (item.file) URL.revokeObjectURL(item.url);
      input.value = '';
      setItems(photos.map((p) => ({ key: `e:${p.path}`, url: p.url })));
    };
    form.addEventListener('submit', onSubmit);
    form.addEventListener('photos:prepare', onPrepare);
    form.addEventListener('photos:saved', onSaved);
    return () => {
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('photos:prepare', onPrepare);
      form.removeEventListener('photos:saved', onSaved);
    };
  }, []);

  const change = (next: PhotoItem[]) => {
    changedByUser.current = true;
    setItems(next);
  };

  return (
    <>
      <PhotoManager items={items} onChange={change} keepOne message={message} />
      <input ref={fileInput} type="file" name="photos" multiple hidden tabIndex={-1} aria-hidden="true" autocomplete="off" />
    </>
  );
}
