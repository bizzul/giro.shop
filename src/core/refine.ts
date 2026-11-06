import { normalize } from './text.ts';

/**
 * Togliere un filtro dalla frase scritta dalla persona, senza riscriverla:
 * "scrivania in legno sotto i 150 franchi vicino a Lugano" senza la zona diventa
 * "scrivania in legno sotto i 150 franchi". Maiuscole, accenti e punteggiatura restano com'erano.
 */

interface RawToken {
  /** Parola normalizzata, come la vede parseQuery. */
  norm: string;
  /** Posizione della parola originale nella frase. */
  start: number;
  end: number;
}

/** Le parole della frase originale, con la loro forma normalizzata e la posizione. */
function rawTokens(raw: string): RawToken[] {
  const out: RawToken[] = [];
  for (const m of raw.matchAll(/[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu)) {
    const start = m.index ?? 0;
    // "l'armadio" diventa due parole normalizzate, entrambe legate alla stessa parola originale
    for (const norm of normalize(m[0]).split(' ').filter(Boolean)) {
      out.push({ norm, start, end: start + m[0].length });
    }
  }
  return out;
}

/** Spazi doppi e virgole rimaste orfane dopo aver tolto un pezzo. */
function tidy(text: string): string {
  return text
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/([,;:])(?=\s*(?:[,;:.]|$))/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.]+/, '')
    .replace(/[\s,;:]+$/, '')
    .trim();
}

/**
 * Toglie la prima sequenza di parole uguale a `fragment` (già normalizzato).
 * `leading` sono le parole di collegamento da togliere insieme, se vengono subito prima
 * ("vicino a" prima di un comune, "in" prima di un materiale).
 * Restituisce null se il pezzo non si trova.
 */
export function removeFragment(raw: string, fragment: string, leading: ReadonlySet<string> = new Set()): string | null {
  const want = fragment.trim().split(/\s+/).filter(Boolean);
  if (!want.length) return null;
  const tokens = rawTokens(raw);
  for (let i = 0; i + want.length <= tokens.length; i++) {
    if (!want.every((w, j) => tokens[i + j].norm === w)) continue;
    let first = i;
    while (first > 0 && leading.has(tokens[first - 1].norm) && tokens[first - 1].end <= tokens[first].start) first--;
    const start = tokens[first].start;
    const end = tokens[i + want.length - 1].end;
    return tidy(`${raw.slice(0, start)} ${raw.slice(end)}`);
  }
  return null;
}

/** Come removeFragment, per più pezzi di fila (es. "entro 5 km" e "Lugano"). */
export function removeFragments(raw: string, parts: Array<{ fragment: string; leading?: ReadonlySet<string> }>): string | null {
  let text: string | null = raw;
  for (const part of parts) {
    if (text == null) return null;
    text = removeFragment(text, part.fragment, part.leading);
  }
  return text;
}

/** Parole che portano a un luogo: si tolgono con il luogo. */
export const PLACE_LEAD = new Set(
  'a ad in vicino zona dintorni di da presso attorno intorno dalle parti nei nel nella verso al alla dei'.split(' '),
);
/** "in legno", "di pelle" */
export const MATERIAL_LEAD = new Set(['in', 'di']);
/** "con ritiro", "solo ritiro" */
export const PICKUP_LEAD = new Set(['con', 'solo', 'per']);
