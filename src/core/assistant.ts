import type { Listing } from './types.ts';
import { getComune } from './comuni.ts';
import { CONDITION_LABEL, formatChf } from './format.ts';
import { formatPickup } from './pickup.ts';
import { normalize, tokenize } from './text.ts';

/**
 * Assistente venditore, la parte senza AI: riconosce le domande ripetitive di chi compra
 * e risponde solo con i dati dell'annuncio e con le risposte già date nelle domande pubbliche.
 * Non tratta il prezzo e non promette nulla: accettare resta una decisione di chi vende.
 */

export type Intent = 'disponibile' | 'dove' | 'spedizione' | 'trattabile' | 'quando' | 'condizioni';

const INTENTS: Array<[Intent, RegExp]> = [
  ['disponibile', /\b(disponibil|ancora in vendita|ce ancora|c e ancora|ce l hai ancora|e ancora tuo|l hai venduto|e venduto|gia venduto)/],
  ['dove', /\b(dove (si )?(ritir|pass|trov|si trova|e)|dove sei|in che zona|che zona|da dove|indirizzo|in che paese|dove abiti)/],
  ['spedizione', /\b(spedi|spediz|invi(i|ar|are|arlo|armelo)|posta|corriere|mandarmelo|consegn)/],
  ['trattabile', /\b(trattabil|ultimo prezzo|prezzo minimo|sconto|si puo trattare|trattare|fai di meno|meno di cosi|il minimo)/],
  ['quando', /\b(quando (posso|potrei|si puo|e possibile|ci vediamo|sei libero|sei libera)|posso passare|posso venire|potrei passare|potrei venire|passare a (prenderlo|prenderla|ritirarlo|ritirarla)|orari|che giorn|quando sei disponibil)/],
  ['condizioni', /\b(che (stato|condizion)|in che stato|condizioni|funziona|difett|graffi|rott)/],
];

/** Le domande ripetitive che riconosciamo in un messaggio. */
export function intentsOf(text: string): Intent[] {
  const n = normalize(text);
  return INTENTS.filter(([, re]) => re.test(n)).map(([intent]) => intent);
}

const STOP = new Set(['sono', 'della', 'delle', 'questo', 'questa', 'ancora', 'anche', 'come', 'quanto', 'quale', 'ciao', 'buongiorno', 'buonasera', 'grazie', 'salve', 'vorrei', 'sapere', 'potresti', 'dirmi']);
const roots = (text: string) => new Set(tokenize(text).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));

/** Una domanda pubblica già risposta che dice la stessa cosa del messaggio, se c'è. */
export function matchingAnswer(text: string, questions: Listing['questions']): { question: string; answer: string } | null {
  const asked = roots(text);
  if (asked.size === 0) return null;
  let best: { question: string; answer: string; score: number } | null = null;
  for (const q of questions ?? []) {
    if (!q.answer) continue;
    const theirs = roots(q.body);
    const shared = [...asked].filter((r) => theirs.has(r)).length;
    // Almeno due parole in comune, o quasi tutte le parole di una domanda corta
    const score = shared / Math.min(asked.size, theirs.size || 1);
    if ((shared >= 2 || (shared === 1 && asked.size <= 2 && theirs.size <= 3)) && score >= 0.5 && (!best || score > best.score)) {
      best = { question: q.body, answer: q.answer, score };
    }
  }
  return best && { question: best.question, answer: best.answer };
}

/** I fatti dell'annuncio che l'assistente può dire, in frasi brevi (anche per Claude). */
export function listingFacts(listing: Listing): string[] {
  const comune = getComune(listing.comuneId)?.name ?? listing.comuneId;
  const attrs = Object.entries(listing.attributes).map(([k, v]) => `${k}: ${v}`);
  return [
    `Titolo: ${listing.title}`,
    `Prezzo: ${listing.priceChf === 0 ? 'regalo' : formatChf(listing.priceChf)}${listing.negotiable ? ', trattabile' : ', prezzo fisso'}`,
    `Stato della vendita: ${listing.status === 'venduto' ? 'venduto' : listing.negotiating ? 'in trattativa con un\'altra persona' : 'ancora disponibile'}`,
    `Condizione: ${CONDITION_LABEL[listing.condition]}`,
    `Ritiro a: ${comune}`,
    `Spedizione: ${listing.shipping ? `sì${listing.shippingChf != null ? `, ${formatChf(listing.shippingChf)}` : ', costo da concordare'}` : 'no, solo ritiro di persona'}`,
    ...(attrs.length ? [`Dettagli: ${attrs.join('; ')}`] : []),
    `Descrizione: ${listing.description || '—'}`,
  ];
}

export interface AssistantReply {
  /** Il messaggio da mandare a nome di chi vende, oppure null: risponde la persona. */
  text: string | null;
  /** Orario di ritiro da proporre con un tocco, se chi compra chiede quando passare. */
  slot: string | null;
}

/**
 * Risposta con regole semplici. `slots` sono i prossimi orari liberi di chi vende (vedi nextSlots).
 * Senza nessuna domanda riconosciuta non risponde: meglio il silenzio di una risposta a caso.
 */
export function ruleReply(input: { text: string; listing: Listing; sellerName: string; slots: string[]; now?: Date }): AssistantReply {
  const { listing, sellerName, slots } = input;
  const intents = intentsOf(input.text);
  const comune = getComune(listing.comuneId)?.name ?? listing.comuneId;
  const parts: string[] = [];
  let slot: string | null = null;

  if (intents.includes('disponibile')) {
    parts.push(
      listing.status === 'venduto'
        ? 'Mi dispiace, è già venduto.'
        : listing.negotiating
          ? `È in trattativa con un'altra persona. Se salta, ${sellerName} ti scrive: intanto puoi lasciare un'offerta.`
          : 'Sì, è ancora disponibile.',
    );
  }
  if (intents.includes('dove')) parts.push(`Il ritiro è a ${comune}.`);
  if (intents.includes('spedizione')) {
    parts.push(
      listing.shipping
        ? `Sì, si può spedire${listing.shippingChf != null ? ` (${formatChf(listing.shippingChf)})` : ': il costo è da concordare'}.`
        : `No, solo ritiro di persona a ${comune}.`,
    );
  }
  if (intents.includes('trattabile')) {
    parts.push(listing.negotiable ? 'Il prezzo è trattabile: fai pure un\'offerta qui sotto.' : `Il prezzo è fisso, ma puoi comunque proporre un'offerta: decide ${sellerName}.`);
  }
  if (intents.includes('condizioni')) {
    const known = matchingAnswer(input.text, listing.questions);
    parts.push(known ? `Ne ha già parlato nelle domande pubbliche: «${known.answer}»` : `Condizione indicata: ${CONDITION_LABEL[listing.condition].toLowerCase()}. Per i dettagli ti risponde ${sellerName}.`);
  } else if (!parts.length) {
    const known = matchingAnswer(input.text, listing.questions);
    if (known) parts.push(`Ne ha già parlato nelle domande pubbliche: «${known.answer}»`);
  }
  if (intents.includes('quando') && listing.status !== 'venduto') {
    const reply = slotText(slots, input.now);
    if (reply) {
      parts.push(reply.text);
      slot = reply.slot;
    }
  }
  return { text: parts.length ? parts.join(' ') : null, slot };
}

/** "Ti propongo sabato 14 novembre alle 10:00, oppure lunedì 16 novembre alle 18:30." */
export function slotText(slots: string[], now = new Date()): { text: string; slot: string } | null {
  if (!slots.length) return null;
  const others = slots.slice(1, 3).map((s) => formatPickup(s, now));
  return {
    slot: slots[0],
    text: `Ti propongo ${formatPickup(slots[0], now)}${others.length ? `, oppure ${others.join(' o ')}` : ''}. Trovi la proposta qui sotto: accettala con un tocco o proponi tu giorno e ora.`,
  };
}
