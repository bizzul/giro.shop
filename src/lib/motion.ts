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

/** Il pezzo di testata che arriva dal server island UserMenu (vedi MENU_SCRIPT in Layout.astro). */
const MENU = '.top nav > :is(.nav-messages, .nav-saved, .nav-account, .nav-login, [data-mano-account])';

/**
 * Uscendo dalla pagina si ricorda il menu account com'era, per mostrarlo subito sulla pagina dopo.
 * Solo in questa scheda (sessionStorage). Uscendo dall'account si dimentica.
 */
export function rememberMenu() {
  addEventListener('pagehide', () => {
    const parts = [...document.querySelectorAll(MENU)];
    if (!parts.length) return; // l'isola non è ancora arrivata: resta quello di prima
    try {
      sessionStorage.setItem('giro:menu', parts.map((el) => el.outerHTML).join(''));
    } catch {
      /* senza sessionStorage resta il segnaposto */
    }
  });
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.action?.includes('signOut')) return;
    try {
      sessionStorage.removeItem('giro:menu');
    } catch {
      /* niente */
    }
  });
}
