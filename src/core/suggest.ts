import type { Listing } from './types.ts';
import { normalize, stem } from './text.ts';
import { isStopword } from './query.ts';
import { COMUNI } from './comuni.ts';
import { CATEGORIES } from './categories.ts';
import { PLACE_LEAD } from './refine.ts';

/**
 * Suggerimenti mentre si scrive: completano l'ultima parola della frase
 * con parole e brevi frasi che esistono davvero negli annunci, con i nomi dei comuni
 * e delle categorie. "scrivania in no" → "scrivania in noce", "bici a Bel" → "bici a Bellinzona".
 */

interface Candidate {
  text: string;
  score: number;
}

/** Parole del titolo così come sono scritte, senza la punteggiatura attaccata. */
function words(title: string): Array<{ raw: string; norm: string; endsClause: boolean }> {
  return title
    .split(/\s+/)
    .map((w) => {
      const endsClause = /[,;:.!?)]$/.test(w);
      const raw = w.replace(/^[("«]+|[,;:.!?)"»]+$/g, '');
      return { raw, norm: normalize(raw), endsClause };
    })
    .filter((w) => w.norm);
}

/** Minuscola iniziale, tranne per marche e sigle (IKEA, iPhone, Bianchi a metà frase). */
function lowerFirst(word: string, atStart: boolean): string {
  if (!atStart || /^[A-Z0-9]{2,}$/.test(word) || /[a-z][A-Z]/.test(word)) return word;
  return word.charAt(0).toLowerCase() + word.slice(1);
}

export function suggest(query: string, listings: Listing[], limit = 6): string[] {
  // Si completa solo una parola in corso: dopo uno spazio non c'è niente da completare
  if (!query || /\s$/.test(query)) return [];
  const match = query.match(/^(.*?)([^\s]+)$/s);
  if (!match) return [];
  const [, head, last] = match;
  const prefix = normalize(last);
  if (prefix.length < 2 || /^\d+$/.test(prefix)) return [];
  const headTokens = normalize(head).split(' ').filter(Boolean);
  const before = headTokens.at(-1);
  // Le parole già scritte ("giacca da sc"): contano di più gli annunci che le contengono
  const context = headTokens.filter((t) => t.length > 2 && !isStopword(t) && !/^\d+$/.test(t)).map(stem);

  // Singolare e plurale contano come la stessa proposta (scrivania, scrivanie)
  const found = new Map<string, Candidate>();
  const add = (text: string, score: number) => {
    const norm = normalize(text);
    if (!norm || norm === prefix) return;
    const key = norm.split(' ').map(stem).join(' ');
    const current = found.get(key);
    if (current) current.score += score;
    else found.set(key, { text, score });
  };

  // Comuni: dopo "a", "vicino", "zona" si propongono solo luoghi
  const placeContext = before != null && PLACE_LEAD.has(before);
  if (placeContext || prefix.length >= 3) {
    for (const c of COMUNI) {
      if (normalize(c.name).startsWith(prefix)) add(c.name, placeContext ? 50 : 4);
    }
    if (placeContext && found.size) return ranked(found, head, limit);
  }

  // Con parole già scritte si guardano solo gli annunci che le contengono ("giacca da sc" → sci, non scrivania);
  // se nessuno le contiene, tutti.
  const related = listings.filter((l) => {
    const text = ` ${normalize(`${l.title} ${l.tags.join(' ')}`)}`;
    return context.every((c) => text.includes(` ${c}`));
  });

  // Parole e frasi brevi dai titoli: "scrivania", "scrivania in noce"
  const collect = (pool: Listing[]) => {
    for (const listing of pool) {
      const ws = words(listing.title);
      ws.forEach((w, i) => {
        if (!w.norm.startsWith(prefix)) return;
        add(lowerFirst(w.raw, i === 0), 3);
        // Fino a tre parole, senza superare una virgola e senza finire con "in", "da", "con"…
        const phrase = [lowerFirst(w.raw, i === 0)];
        let ends = w.endsClause;
        for (let j = i + 1; j < ws.length && phrase.length < 3 && !ends; j++) {
          if (/\d/.test(ws[j].norm)) break;
          phrase.push(ws[j].raw);
          ends = ws[j].endsClause;
          if (!isStopword(ws[j].norm)) add(phrase.join(' '), 2);
        }
      });
      // Parole chiave e materiale: aiutano con "in le" → "in legno"
      for (const t of [...listing.tags, listing.attributes.materiale ?? '']) {
        for (const n of normalize(t).split(' ')) {
          if (n.length > 2 && n.startsWith(prefix) && !isStopword(n)) add(n, 1);
        }
      }
    }
  };
  collect(context.length && related.length ? related : listings);
  // Le parole già scritte non portano a niente: si cerca in tutti gli annunci ("tavolo in le" → legno)
  if (found.size === 0 && context.length && related.length) collect(listings);

  // Nomi delle categorie: "bici da corsa", "bici per bambini" (solo a inizio frase)
  for (const cat of context.length ? [] : CATEGORIES) {
    for (const [, label] of cat.keywords) {
      if (normalize(label).startsWith(prefix)) add(label.charAt(0).toLowerCase() + label.slice(1), 2);
    }
  }

  return ranked(found, head, limit);
}

function ranked(found: Map<string, Candidate>, head: string, limit: number): string[] {
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .slice(0, limit)
    .map((c) => `${head}${c.text}`);
}
