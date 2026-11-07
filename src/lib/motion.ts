/**
 * Foto delle card che sfumano dentro quando arrivano (stili in global.css, sezione "Movimento").
 * Ogni foto pronta (o fallita: si vede almeno il testo alternativo) prende data-ok.
 * La classe .motion su <html> accende l'effetto solo dopo aver segnato quelle già pronte:
 * senza JavaScript, o prima di qui, le foto si vedono subito come sempre.
 */
export function initMotion() {
  const mark = (img: HTMLImageElement) => {
    img.dataset.ok = '';
  };
  for (const img of document.querySelectorAll<HTMLImageElement>('.lph img')) {
    if (img.complete) mark(img);
  }
  // load ed error non risalgono il documento, ma si sentono in cattura: vale anche per le card aggiunte dopo
  const done = (event: Event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.closest('.lph')) mark(img);
  };
  document.addEventListener('load', done, true);
  document.addEventListener('error', done, true);
  document.documentElement.classList.add('motion');
}

/**
 * Prima di sostituire i risultati: ricorda card e chip in vista, così dopo l'aggiornamento
 * quelle rimaste restano ferme (.stay) e si animano solo le nuove.
 */
export function keepSteady(root: HTMLElement) {
  const cards = new Set([...root.querySelectorAll('a.lcard')].map((a) => a.getAttribute('href')));
  const chips = new Set([...root.querySelectorAll('.understood .chip')].map((c) => c.textContent?.trim()));
  return () => {
    for (const a of root.querySelectorAll('a.lcard')) if (cards.has(a.getAttribute('href'))) a.classList.add('stay');
    for (const c of root.querySelectorAll('.understood .chip')) if (chips.has(c.textContent?.trim())) c.classList.add('stay');
    // Le foto già in cache non devono ripassare dal riflesso
    for (const img of root.querySelectorAll<HTMLImageElement>('.lph img')) if (img.complete) img.dataset.ok = '';
  };
}
