/**
 * Barra dei comandi su telefono (il <nav> dell'intestazione, messo sul lato dagli stili in global.css):
 * - sale sopra le barre fissate in basso (ricerca, barra della scheda, riquadro per scrivere),
 *   cioè gli elementi con [data-bottom-ui]: lo spazio che occupano diventa --rail-lift;
 * - esce di lato quando si scorre verso il basso (classe rail-away su <html>) e torna scorrendo verso l'alto,
 *   così non copre gli annunci mentre si guarda;
 * - esce anche quando è aperta la tastiera (classe rail-kb), che prende il suo posto;
 * - esce finché il fuoco sta su un comando che coprirebbe (tastiera fisica, comandi vocali).
 */
const PHONE = '(max-width: 760px)';
/** Scorrimento minimo prima di nascondere o mostrare la barra, per non farla tremolare. */
const STEP = 8;
/** Vicino all'inizio della pagina la barra c'è sempre. */
const TOP = 96;
/** Una barra "sta in basso" se il suo bordo inferiore è a meno di tanto dal fondo dello schermo. */
const NEAR_BOTTOM = 40;
/** Pochi pixel in meno sono solo la barra del browser che compare o sparisce, non la tastiera. */
const KEYBOARD = 80;

export function initRail() {
  const root = document.documentElement;
  const phone = matchMedia(PHONE);
  let lastY = scrollY;
  let away = false;
  /** Il fuoco è su un comando che la barra coprirebbe. */
  let covered = false;
  let frame = 0;

  /** Quanto occupano dal fondo dello schermo le barre fissate in basso che si vedono ora. */
  function bottomUi(): number {
    const height = innerHeight;
    let lift = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-bottom-ui]')) {
      const box = el.getBoundingClientRect();
      // Conta solo se sta sul fondo dello schermo (fissata o appiccicata in basso, anche staccata
      // di qualche pixel come la ricerca) ed è in vista
      if (box.height > 0 && box.bottom >= height - NEAR_BOTTOM && box.top < height) lift = Math.max(lift, height - box.top);
    }
    return Math.round(lift);
  }

  function update() {
    frame = 0;
    if (!phone.matches) {
      root.classList.remove('rail-away', 'rail-kb');
      root.style.removeProperty('--rail-lift');
      return;
    }
    // Senza barre in basso resta lo spazio della barra di sistema (iPhone senza tasto Home)
    const lift = bottomUi();
    root.style.setProperty('--rail-lift', lift > 0 ? `${lift}px` : 'env(safe-area-inset-bottom, 0px)');

    const y = scrollY;
    const delta = y - lastY;
    if (y < TOP) away = false;
    else if (delta > STEP) away = true;
    else if (delta < -STEP) away = false;
    if (Math.abs(delta) > STEP || y < TOP) lastY = y;
    root.classList.toggle('rail-away', away || covered);
    root.classList.toggle('rail-kb', keyboardOpen());
  }

  /**
   * Tastiera aperta: la parte visibile della pagina (visualViewport) è più bassa di quella su cui
   * sono fissati gli elementi. Un campo col fuoco da solo non basta: con l'autofocus (es. /cerca)
   * la tastiera non è aperta e la barra deve restare.
   */
  function keyboardOpen(): boolean {
    const vv = window.visualViewport;
    return Boolean(vv && root.clientHeight - vv.height - vv.offsetTop > KEYBOARD);
  }

  const schedule = () => {
    frame ||= requestAnimationFrame(update);
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  phone.addEventListener('change', schedule);
  // Le barre in basso entrano ed escono con una transizione (es. quella della scheda annuncio)
  document.addEventListener('transitionend', (event) => {
    if ((event.target as Element).closest?.('[data-bottom-ui]')) schedule();
  });
  // Un comando sotto la barra che prende il fuoco (tastiera, comandi vocali): la barra esce di lato finché il fuoco
  // resta lì, così il comando si vede. La posizione della barra è quella di quando si vede: offsetLeft e offsetTop
  // ignorano lo spostamento di lato.
  const rail = document.querySelector<HTMLElement>('.top nav');
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    covered = false;
    if (phone.matches && rail && target instanceof Element && !rail.contains(target)) {
      const a = target.getBoundingClientRect();
      const left = rail.offsetLeft;
      const top = rail.offsetTop;
      covered = a.right > left && a.left < left + rail.offsetWidth && a.bottom > top && a.top < top + rail.offsetHeight;
    }
    schedule();
  });
  document.addEventListener('focusout', () => {
    covered = false;
    schedule();
  });
  // Il riquadro per scrivere cresce con il testo; le server island arrivano dopo il caricamento
  if ('ResizeObserver' in window) {
    const sizes = new ResizeObserver(schedule);
    for (const el of document.querySelectorAll('[data-bottom-ui]')) sizes.observe(el);
  }
  update();
  // Dopo la prima misura le variazioni si animano
  setTimeout(() => root.classList.add('rail-ready'), 50);
}
