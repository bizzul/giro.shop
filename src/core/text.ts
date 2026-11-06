/**
 * Normalizza un testo per i confronti: minuscolo, senza accenti,
 * numeri svizzeri uniti (2'000 → 2000) e solo lettere e cifre.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d)['’](?=\d)/g, '$1')
    .replace(/(\d)\.(?=\d{3}\b)/g, '$1')
    .replace(/\be-bike\b/g, 'ebike')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(' ') : [];
}

/** Radice grezza: toglie la vocale finale (scrivania/scrivanie → scrivani). */
export function stem(token: string): string {
  return token.length > 4 ? token.replace(/[aeiou]$/, '') : token;
}

/** Le radici corte (sci, tv, pc) devono coincidere; le altre bastano come inizio parola. */
export function tokenMatches(token: string, alt: string): boolean {
  if (alt.length <= 3) return token === alt;
  return token.startsWith(alt);
}

/**
 * Prima lettera maiuscola. Se il testo è scritto quasi tutto in maiuscolo, abbassa le parole
 * (le lettere singole come la taglia "M" restano com'erano).
 */
export function sentenceCase(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  const letters = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '').length;
  const isShouting = letters.length > 6 && upper / letters.length > 0.6;
  const base = isShouting ? trimmed.replace(/[A-Za-zÀ-ÿ]{2,}/g, (w) => w.toLowerCase()) : trimmed;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
