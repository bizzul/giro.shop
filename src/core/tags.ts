import type { CategoryId, Listing } from './types.ts';
import { getCategory } from './categories.ts';
import { isStopword } from './query.ts';
import { normalize, stem, tokenMatches, tokenize } from './text.ts';

export interface TagSubject {
  /** Per non contare l'annuncio stesso tra quelli simili. */
  id?: string;
  title: string;
  description?: string;
  category: CategoryId;
  /** Parole chiave che ha già: non si ripropongono. */
  tags: string[];
}

/** Chiave per riconoscere la stessa parola chiave scritta in modo diverso (Scrivanie, scrivania). */
export function tagKey(tag: string): string {
  return tokenize(tag).map(stem).join(' ');
}

/** Parole troppo generiche per servire da parola chiave. */
const GENERIC = new Set(['taglia', 'misura', 'misure', 'colore', 'pezzo', 'pezzi', 'perfetto', 'perfetta', 'ottime', 'regalo', 'trattabile', 'vendita']);

const usable = (word: string) => word.length > 3 && !/^\d+$/.test(word) && !isStopword(word) && !GENERIC.has(word);

/**
 * Parole chiave consigliate per un annuncio, le migliori prima:
 * - quelle usate dagli annunci simili (stessa categoria, parole del titolo in comune), di più se il testo le nomina;
 * - l'oggetto riconosciuto dalla categoria ("divano" nel titolo → divani);
 * - le parole importanti del titolo (marche, materiali).
 */
export function suggestTags(subject: TagSubject, listings: Listing[], limit = 8): string[] {
  const titleWords = tokenize(subject.title).filter(usable);
  const titleStems = new Set(titleWords.map(stem));
  // L'oggetto è la prima parola che conta: "Lampada da scrivania" è una lampada, non una scrivania
  const object = titleWords[0] ? stem(titleWords[0]) : null;
  const text = ` ${tokenize(`${subject.title} ${subject.description ?? ''}`).map(stem).join(' ')} `;
  const taken = new Set(subject.tags.map(tagKey));
  const scores = new Map<string, { tag: string; score: number }>();
  const add = (raw: string, score: number) => {
    const tag = raw.trim().toLowerCase();
    const key = tagKey(tag);
    if (!key || taken.has(key) || tag.length > 30) return;
    const current = scores.get(key);
    if (current) current.score += score;
    else scores.set(key, { tag, score });
  };

  // Annunci simili: contano molto quelli dello stesso oggetto, poco il resto della categoria; da altre categorie solo i molto simili
  for (const listing of listings) {
    if (listing.id === subject.id) continue;
    const words = new Set(tokenize(`${listing.title} ${listing.tags.join(' ')}`).map(stem));
    const overlap = [...titleStems].filter((s) => words.has(s)).length;
    const sameObject = object !== null && words.has(object);
    const sameCategory = listing.category === subject.category;
    if (!sameCategory && !(sameObject && overlap >= 2)) continue;
    const weight = !sameCategory ? 0.4 * (1 + overlap * 2) : sameObject ? 3 + overlap * 2 : 0.5 + overlap * 0.5;
    for (const tag of listing.tags) {
      const mentioned = text.includes(` ${tagKey(tag)} `);
      add(tag, weight + (mentioned ? 6 : 0));
    }
  }

  // L'oggetto riconosciuto tra le parole chiave della categoria, se non c'è già (giacca → giacche no)
  const tokens = tokenize(`${subject.title} ${subject.description ?? ''}`);
  const tagged = subject.tags.flatMap(tokenize);
  for (const [root, label] of getCategory(subject.category).keywords) {
    const words = root.split(' ');
    if (words.length === 1 && tagged.some((t) => tokenMatches(t, root))) continue;
    const hit = words.length === 1 ? tokens.some((t) => tokenMatches(t, root)) : normalize(subject.title).includes(root);
    if (hit) add(label, 5);
  }

  // Il decennio: "anni 70", "anni '80"; gli altri decenni degli annunci simili non c'entrano
  const decades = new Set([...`${subject.title} ${subject.description ?? ''}`.matchAll(/\banni\s*['’]?\s*([1-9]0)\b/gi)].map((m) => `anni ${m[1]}`));
  for (const decade of decades) add(decade, 4);
  if (decades.size) {
    for (const [k, { tag }] of scores) if (/^anni \d0$/.test(tag) && !decades.has(tag)) scores.delete(k);
  }

  // Le parole del titolo (marche, materiali, modelli), se non sono già dentro una parola chiave ("mountain bike")
  const taggedStems = new Set(tagged.map(stem));
  for (const raw of subject.title.split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const norm = normalize(word);
    if (!norm.includes(' ') && usable(norm) && !taggedStems.has(stem(norm))) add(word, 3);
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag, 'it'))
    .slice(0, limit)
    .map((s) => s.tag);
}
