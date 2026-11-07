import type { CategoryId, Condition } from './types.ts';
import { CATEGORY_IDS, CONDITIONS } from './types.ts';
import { CATEGORIES, detectCategory } from './categories.ts';
import { resolveComune } from './comuni.ts';
import { normalize, tokenize } from './text.ts';

/**
 * Import del catalogo per i negozi Pro: un file CSV (da Excel, dal gestionale o scritto a mano)
 * con una riga per oggetto. Le colonne si riconoscono dal nome, in italiano, tedesco o inglese;
 * categoria e condizione si uniformano da sole, il separatore (; , o tab) si indovina.
 */

export const MAX_CATALOG_ROWS = 100;

export interface CatalogRow {
  line: number;
  title: string;
  description: string;
  category: CategoryId;
  condition: Condition;
  priceChf: number | null;
  comuneId: string | null;
  photos: string[];
  shipping: boolean;
  errors: string[];
}

const COLUMNS: Record<keyof Omit<CatalogRow, 'line' | 'errors'>, string[]> = {
  title: ['titolo', 'title', 'titel', 'nome', 'articolo', 'oggetto'],
  description: ['descrizione', 'description', 'beschreibung', 'testo', 'dettagli'],
  category: ['categoria', 'category', 'kategorie'],
  condition: ['condizione', 'condizioni', 'stato', 'condition', 'zustand'],
  priceChf: ['prezzo', 'price', 'preis', 'chf', 'prezzo chf'],
  comuneId: ['comune', 'luogo', 'localita', 'ort', 'place', 'ritiro'],
  photos: ['foto', 'fotos', 'photo', 'photos', 'immagini', 'bilder', 'images'],
  shipping: ['spedizione', 'versand', 'shipping', 'spedibile'],
};

/** Divide una riga CSV rispettando le virgolette ("Divano, 3 posti"). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/** "1'200.–", "CHF 1200", "1.200,50" → numero; null se non si capisce. */
export function parsePrice(value: string): number | null {
  let v = value.replace(/chf|fr\.?|\s|['’]/gi, '').replace(/[.,]-+$|–$/, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : null;
}

const CONDITION_WORDS: Array<[RegExp, Condition]> = [
  [/^(nuov|new|neu)/, 'nuovo'],
  [/^(come nuov|pari al nuovo|wie neu|like new)/, 'come_nuovo'],
  [/^(da ripar|difettos|defekt|broken)/, 'da_riparare'],
  [/^(usat|gebraucht|used)/, 'usato'],
  [/^(buon|good|gut)/, 'buono'],
];

function conditionOf(value: string): Condition | null {
  const n = normalize(value);
  if (!n) return null;
  const id = n.replace(/ /g, '_');
  if ((CONDITIONS as readonly string[]).includes(id)) return id as Condition;
  // "come nuovo" prima di "nuovo"
  const ordered = [CONDITION_WORDS[1], ...CONDITION_WORDS.filter((_, i) => i !== 1)];
  return ordered.find(([re]) => re.test(n))?.[1] ?? null;
}

function categoryOf(value: string, title: string): CategoryId {
  const n = normalize(value);
  if (n) {
    const id = n.replace(/ /g, '_');
    if ((CATEGORY_IDS as readonly string[]).includes(id)) return id as CategoryId;
    const byName = CATEGORIES.find((c) => normalize(c.name) === n);
    if (byName) return byName.id;
    const detected = detectCategory(tokenize(value));
    if (detected) return detected.id;
  }
  return detectCategory(tokenize(title))?.id ?? 'altro';
}

export function parseCatalog(text: string, defaultComune?: string): { rows: CatalogRow[]; error?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: 'Servono una riga di intestazione e almeno un oggetto.' };
  const header = lines[0];
  const sep = [';', '\t', ','].map((s) => [s, header.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const names = splitLine(header, sep).map((h) => normalize(h));
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, aliases]) => [key, names.findIndex((h) => aliases.includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (index.title < 0 || index.priceChf < 0) return { rows: [], error: 'Mancano le colonne «titolo» e «prezzo».' };
  if (lines.length - 1 > MAX_CATALOG_ROWS) return { rows: [], error: `Al massimo ${MAX_CATALOG_ROWS} oggetti per volta.` };

  const fallbackComune = defaultComune ? (resolveComune(defaultComune)?.id ?? null) : null;
  const rows = lines.slice(1).map((line, i): CatalogRow => {
    const cells = splitLine(line, sep);
    const cell = (key: keyof typeof COLUMNS) => (index[key] >= 0 ? (cells[index[key]] ?? '') : '');
    const errors: string[] = [];
    const title = cell('title').replace(/\s+/g, ' ').trim();
    if (title.length < 3) errors.push('titolo troppo corto');
    if (title.length > 80) errors.push('titolo oltre 80 caratteri');
    const priceChf = parsePrice(cell('priceChf'));
    if (priceChf == null) errors.push('prezzo non valido');
    const comuneText = cell('comuneId');
    const comuneId = comuneText ? (resolveComune(comuneText)?.id ?? null) : fallbackComune;
    if (!comuneId) errors.push(comuneText ? `comune «${comuneText}» sconosciuto` : 'manca il comune');
    const photos = cell('photos')
      .split(/[\s|]+/)
      .filter((u) => /^https:\/\//i.test(u))
      .slice(0, 5);
    return {
      line: i + 2,
      title: title.slice(0, 80),
      description: cell('description').slice(0, 4000),
      category: categoryOf(cell('category'), title),
      condition: conditionOf(cell('condition')) ?? 'buono',
      priceChf,
      comuneId,
      photos,
      shipping: /^(si|sì|yes|ja|1|x|true)$/i.test(cell('shipping').trim()),
      errors,
    };
  });
  return { rows };
}
