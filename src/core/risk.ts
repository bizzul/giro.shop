import type { PriceEstimate } from './types.ts';
import { formatChf } from './format.ts';
import { normalize } from './text.ts';

/**
 * Rischio truffa, con regole semplici e spiegabili:
 * - nei messaggi: un avviso a chi li riceve (link esterni, pagamento in anticipo, codici SMS, dati della carta...);
 * - negli annunci: un punteggio da 0 a 1 con i motivi, che porta l'annuncio in cima alla pagina di moderazione.
 * Il punteggio non nasconde niente da solo: decidono le persone che moderano.
 */

export type Signal = 'link' | 'anticipo' | 'codice' | 'carta' | 'corriere' | 'fuori' | 'prezzo' | 'copia';

interface Rule {
  signal: Signal;
  weight: number;
  /** Cosa vede chi riceve il messaggio. */
  warning: string;
  /** Cosa vede chi modera. */
  reason: string;
  test: (raw: string, n: string) => boolean;
}

const RULES: Rule[] = [
  {
    signal: 'codice',
    weight: 0.7,
    warning: 'Chiede un codice ricevuto per SMS: non condividerlo mai, serve a entrare nei tuoi conti.',
    reason: 'Chiede un codice ricevuto per SMS',
    test: (_raw, n) => /\b(codice|code|pin)\b.{0,40}\b(sms|ricevut|arrivat|verifica|conferma|twint)/.test(n) || /\b(mandami|inviami|dammi|girami) (il|quel) codice/.test(n),
  },
  {
    signal: 'carta',
    weight: 0.7,
    warning: 'Chiede i dati della carta: per ricevere soldi non servono mai.',
    reason: 'Chiede i dati della carta',
    test: (_raw, n) => /\b(numero della carta|dati della carta|dati carta|cvv|cvc|codice di sicurezza della carta|scadenza della carta)\b/.test(n),
  },
  {
    signal: 'anticipo',
    weight: 0.6,
    warning: 'Chiede un pagamento in anticipo o con un metodo non tracciabile: paga solo quando vedi l\'oggetto.',
    reason: 'Pagamento in anticipo o non tracciabile',
    test: (_raw, n) =>
      /\b(pagamento anticipat|paga(re|mento)? (in |prima )?anticip|in anticipo|caparra|acconto|western union|moneygram|paysafe|carta regalo|gift ?card|buono regalo|bitcoin|criptovalut|crypto)\b/.test(n) ||
      /\bbonifico\b.{0,40}\b(prima|subito|anticip)/.test(n),
  },
  {
    signal: 'corriere',
    weight: 0.5,
    warning: 'Propone un suo corriere o un\'agenzia di spedizione: è uno schema di truffa diffuso.',
    reason: 'Corriere o agenzia proposti da chi compra',
    test: (_raw, n) => /\b(mio corriere|il corriere (passa|ritira|paga)|agenzia di spedizion|corriere privato|ritiro tramite corriere|spedizione tramite (dhl|ups|fedex))\b/.test(n),
  },
  {
    signal: 'link',
    weight: 0.4,
    warning: 'Contiene un link esterno: non inserire dati o codici su pagine aperte da un link.',
    reason: 'Link esterno',
    test: (raw) => /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.|\b[a-z0-9-]+\.(com|ch|it|net|org|info|xyz|top|link|ly)\/\S*/i.test(raw) || /\b(bit\.ly|tinyurl|t\.me)\b/i.test(raw),
  },
  {
    signal: 'fuori',
    weight: 0.25,
    warning: 'Vuole continuare fuori da giro.shop: qui resta traccia di cosa vi siete detti.',
    reason: 'Contatti per uscire dal sito (WhatsApp, email, telefono)',
    test: (raw, n) =>
      /\b(whatsapp|whats app|telegram|signal|scrivimi (su|a|al)|contattami (su|a|al))\b/.test(n) ||
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(raw) ||
      /(\+41|0041|\b0)\s?7[5-9][\s.]?\d{3}[\s.]?\d{2}[\s.]?\d{2}\b/.test(raw),
  },
];

/** Gli avvisi per chi riceve un messaggio, dal più grave. */
export function messageWarnings(text: string): string[] {
  const n = normalize(text);
  return RULES.filter((r) => r.test(text, n)).map((r) => r.warning);
}

export interface ListingRisk {
  /** 0–1: dalla probabilità combinata dei segnali. */
  score: number;
  signals: Signal[];
  reasons: string[];
}

/** Da quanto un annuncio va guardato prima degli altri. */
export const RISK_REVIEW = 0.5;

/**
 * Rischio di un annuncio: testo (come nei messaggi), prezzo molto sotto gli annunci davvero simili,
 * testo quasi uguale a quello di un'altra persona. Senza cellulare verificato pesa un po' di più, ma solo con altri segnali.
 */
export function listingRisk(input: {
  title: string;
  description: string;
  priceChf: number;
  estimate: PriceEstimate | null;
  copiedFrom?: string | null;
  verified?: boolean;
}): ListingRisk {
  const text = `${input.title}\n${input.description}`;
  const n = normalize(text);
  const hits: Array<{ signal: Signal; weight: number; reason: string }> = RULES.filter((r) => r.test(text, n)).map((r) => ({ signal: r.signal, weight: r.weight, reason: r.reason }));
  const est = input.estimate;
  if (est && est.basis === 'simili' && est.comparables >= 3 && input.priceChf > 0 && input.priceChf < est.low * 0.4) {
    hits.push({ signal: 'prezzo', weight: 0.4, reason: `Prezzo molto sotto gli annunci simili (${formatChf(est.low)}–${formatChf(est.high)})` });
  }
  if (input.copiedFrom) hits.push({ signal: 'copia', weight: 0.5, reason: "Testo quasi uguale a un annuncio di un'altra persona" });
  if (hits.length && input.verified === false) hits.push({ signal: 'fuori', weight: 0.1, reason: 'Cellulare non verificato' });
  const score = 1 - hits.reduce((p, h) => p * (1 - h.weight), 1);
  return {
    score: Math.round(score * 100) / 100,
    signals: [...new Set(hits.map((h) => h.signal))],
    reasons: hits.map((h) => h.reason),
  };
}
