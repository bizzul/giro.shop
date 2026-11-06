import type { Chip, Condition, SearchFilters, TermGroup } from './types.ts';
import { normalize, stem } from './text.ts';
import { detectCategory } from './categories.ts';
import { findComuneIn } from './comuni.ts';
import { formatChf, formatChfRange } from './format.ts';

/** Parole equivalenti, per radice. */
const SYNONYMS: Record<string, string[]> = {
  legn: ['legn', 'noce', 'rover', 'abete', 'faggio', 'pino', 'massell', 'teak', 'ciliegi'],
  bici: ['bici', 'biciclett', 'bike', 'mtb'],
  biciclett: ['bici', 'biciclett', 'bike', 'mtb'],
  bimb: ['bambin', 'bimb', 'ragazz'],
  bambin: ['bambin', 'bimb', 'ragazz'],
  ragazz: ['bambin', 'bimb', 'ragazz'],
  ebike: ['ebike', 'bici elettric', 'pedalata assistita'],
  natel: ['natel', 'smartphon', 'telefon', 'iphone', 'cellular'],
  telefon: ['natel', 'smartphon', 'telefon', 'iphone', 'cellular'],
  passeggin: ['passeggin', 'carrozzin', 'trio'],
  portatil: ['portatil', 'laptop', 'notebook', 'macbook'],
  laptop: ['portatil', 'laptop', 'notebook', 'macbook'],
  metall: ['metall', 'acciaio', 'ferro', 'allumini'],
  'bici bambin': ['bici bambin', 'bici bimb', 'bici ragazz'],
  'bici bimb': ['bici bambin', 'bici bimb', 'bici ragazz'],
  'bici ragazz': ['bici bambin', 'bici bimb', 'bici ragazz'],
};

const MATERIALS = new Set(['legn', 'metall', 'vetro', 'pelle', 'velluto', 'allumini', 'carbonio', 'noce', 'rover', 'faggio', 'teak', 'pino', 'abete']);

const STOPWORDS = new Set(
  (
    'a ad al alla allo ai agli alle anche che chi con col da dal dalla dai dei del della delle di e ed in il la le lo gli i ' +
    'un una uno per poco tra fra su sul sulla o oppure cerco cerca cercasi vendo compro voglio vorrei qualcosa qualche tipo ' +
    'max massimo minimo sotto sopra meno piu fino non oltre almeno franchi franco chf fr km entro raggio vicino zona dintorni ' +
    'presso ritiro consegna mio mia suo sua nostro anni anno circa stato condizioni come nuovo nuova nuovi nuove usato usata ' +
    'budget prezzo euro eur buon buono buona buone ottimo ottima dalle parti attorno intorno qui li la'
  ).split(' '),
);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token) || token === 'vendo' || token === 'cedo' || token === 'regalo';
}

/** Ruote consigliate per età del bambino, in pollici. */
function wheelsForAge(age: number): [number, number] {
  if (age <= 3) return [12, 12];
  if (age <= 5) return [14, 16];
  if (age <= 7) return [16, 20];
  if (age <= 9) return [20, 24];
  return [24, 26];
}

export interface ParsedQuery {
  filters: SearchFilters;
  chips: Chip[];
}

/**
 * Trasforma una frase in filtri veri. Esempio:
 * "scrivania in legno sotto i 150 franchi vicino a Lugano" →
 * scrivanie, ≤ CHF 150, Lugano + 15 km, materiale legno.
 */
export function parseQuery(raw: string): ParsedQuery {
  let n = ` ${normalize(raw)} `;
  const filters: SearchFilters = { raw, groups: [] };
  const chips: Chip[] = [];

  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = n.match(re);
    if (m) n = n.replace(m[0], ' ');
    return m;
  };

  // Fascia di prezzo
  let m = take(/\b(?:tra|fra)\s+(\d+)\s+e\s+(\d+)(?:\s+(?:franchi|chf|fr))?\b/);
  if (m) {
    filters.minPrice = Number(m[1]);
    filters.maxPrice = Number(m[2]);
  }

  // Raggio esplicito
  m = take(/\b(?:entro|nel\s+raggio\s+di|raggio\s+di|raggio)\s+(\d+)\s*km\b/);
  if (m) filters.radiusKm = Number(m[1]);

  if (filters.maxPrice == null) {
    m = take(
      /\b(?:sotto(?:\s+(?:i|ai|a))?|meno\s+di|al\s+massimo|massimo|max|fino\s+a(?:i)?|non\s+oltre|budget(?:\s+di)?)\s+(\d+)(?:\s*(?:franchi|franco|chf|fr))?\b/,
    );
    if (m) filters.maxPrice = Number(m[1]);
  }
  if (filters.minPrice == null) {
    m = take(/\b(?:sopra(?:\s+(?:i|ai))?|almeno|piu\s+di|minimo)\s+(\d+)(?:\s*(?:franchi|chf|fr))?\b/);
    if (m) filters.minPrice = Number(m[1]);
  }
  if (filters.maxPrice == null) {
    m = take(/\b(\d+)\s*(?:franchi|chf|fr)\b/);
    if (m) filters.maxPrice = Number(m[1]);
  }

  // Decennio ("anni 80") o anno ("del 1984")
  m = take(/\banni\s+(\d)0\b/);
  if (m) {
    const d = Number(m[1]);
    filters.yearFrom = (d >= 3 ? 1900 : 2000) + d * 10;
    filters.yearTo = filters.yearFrom + 9;
  } else {
    m = take(/\b(?:del|dal|anno)\s+((?:19|20)\d\d)\b/);
    if (m) filters.yearFrom = Number(m[1]);
  }

  // Età di un bambino ("di 6 anni"): serve per le bici
  const ageMatch = take(/\b(?:di\s+)?(\d{1,2})\s+anni\b/);

  // Condizione
  if (take(/\b(?:anche\s+)?da\s+(?:riparare|sistemare|restaurare|aggiustare)\b|\banche\s+rott[oa]\b|\bper\s+pezzi\b/)) {
    filters.includeBroken = true;
  } else if (take(/\bcome\s+nuov[oaie]\b|\bpari\s+al\s+nuovo\b/)) {
    filters.conditions = ['nuovo', 'come_nuovo'];
  } else if (take(/\b(?:in\s+)?buon[oae]?\s+(?:stato|condizioni)\b/)) {
    filters.conditions = ['nuovo', 'come_nuovo', 'buono'];
  } else if (take(/\bnuov[oaie]\b/)) {
    filters.conditions = ['nuovo'];
  }

  // Ritiro
  if (/\britiro\b/.test(n)) filters.pickup = true;

  // Luogo
  const place = findComuneIn(n.trim());
  if (place) {
    const near = /\b(?:vicino|zona|dintorni|attorno|intorno|parti)\b/.test(n);
    filters.comuneId = place.comune.id;
    filters.radiusKm ??= near ? 15 : 10;
    n = n.replace(` ${place.needle} `, ' ');
  }

  // Categoria e oggetto principale
  const tokens = n.trim().split(/\s+/).filter(Boolean);
  const cat = detectCategory(tokens);
  const consumed = new Set<number>();
  if (cat) {
    filters.category = cat.id;
    filters.categoryLabel = cat.label;
    filters.required = {
      term: cat.keyword,
      alts: SYNONYMS[cat.keyword] ?? [cat.keyword],
    };
    for (let i = cat.index; i < cat.index + cat.length; i++) consumed.add(i);
  }

  // Età → ruote, solo per le bici
  if (ageMatch && filters.category === 'bici') {
    filters.wheelRange = wheelsForAge(Number(ageMatch[1]));
  }

  // Parole restanti: ognuna diventa un gruppo di alternative
  const seen = new Set<string>();
  tokens.forEach((t, i) => {
    if (consumed.has(i) || STOPWORDS.has(t) || /^\d+$/.test(t) || t.length < 2) return;
    const s = stem(t);
    if (seen.has(s)) return;
    seen.add(s);
    const group: TermGroup = {
      term: t,
      alts: SYNONYMS[s] ?? [s],
      kind: MATERIALS.has(s) ? 'materiale' : 'parola',
    };
    filters.groups.push(group);
  });

  // Chip: come il sistema ha capito la frase
  if (filters.categoryLabel) chips.push({ key: 'Categoria', value: filters.categoryLabel });
  if (filters.wheelRange) {
    const [a, b] = filters.wheelRange;
    chips.push({ key: 'Ruote', value: a === b ? `${a}″` : `${a}–${b}″` });
  }
  if (filters.minPrice != null && filters.maxPrice != null) {
    chips.push({ key: 'Prezzo', value: formatChfRange(filters.minPrice, filters.maxPrice) });
  } else if (filters.maxPrice != null) {
    chips.push({ key: 'Prezzo', value: `≤ ${formatChf(filters.maxPrice)}` });
  } else if (filters.minPrice != null) {
    chips.push({ key: 'Prezzo', value: `≥ ${formatChf(filters.minPrice)}` });
  }
  if (place) chips.push({ key: 'Zona', value: `${place.comune.name} + ${filters.radiusKm} km` });
  for (const g of filters.groups) {
    if (g.kind === 'materiale') chips.push({ key: 'Materiale', value: g.term });
  }
  if (filters.yearFrom) {
    chips.push({
      key: 'Anno',
      value: filters.yearTo ? `${filters.yearFrom}–${filters.yearTo}` : `dal ${filters.yearFrom}`,
    });
  }
  if (filters.includeBroken) chips.push({ key: 'Stato', value: 'anche da riparare' });
  if (filters.conditions) chips.push({ key: 'Stato', value: conditionsLabel(filters.conditions) });
  if (filters.pickup) chips.push({ key: 'Consegna', value: 'ritiro' });
  const words = filters.groups.filter((g) => g.kind === 'parola').map((g) => g.term);
  if (words.length) chips.push({ key: 'Parole', value: words.join(', ') });

  return { filters, chips };
}

function conditionsLabel(c: Condition[]): string {
  if (c.length === 1 && c[0] === 'nuovo') return 'nuovo';
  if (c.includes('buono')) return 'almeno buono';
  return 'come nuovo';
}
