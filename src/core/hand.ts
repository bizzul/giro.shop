/**
 * Mano di chi usa il telefono. Su telefono i comandi stanno in una barra sul lato del pollice:
 * a destra di base, a sinistra per chi è mancino (impostazione nel profilo, colonna profiles.left_handed).
 *
 * Nel browser la scelta sta anche in localStorage, così la barra compare subito dal lato giusto
 * (lo script in testa al layout la legge prima del disegno) e su <html data-mano="sinistra">.
 */
export const HANDS = ['destra', 'sinistra'] as const;
export type Hand = (typeof HANDS)[number];

/** Chiave in localStorage. La usano anche gli script inline del layout e del menu account: tenerli allineati. */
export const HAND_KEY = 'giro:mano';

/** Mette la barra dal lato scelto e ricorda la scelta su questo dispositivo. */
export function applyHand(hand: Hand) {
  const root = document.documentElement;
  if (hand === 'sinistra') root.dataset.mano = 'sinistra';
  else delete root.dataset.mano;
  try {
    localStorage.setItem(HAND_KEY, hand);
  } catch {
    // Navigazione privata o archiviazione bloccata: vale fino al prossimo caricamento
  }
}
