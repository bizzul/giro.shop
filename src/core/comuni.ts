import type { Comune } from './types.ts';
import { normalize } from './text.ts';

/**
 * Località ticinesi usate dal prototipo. Coordinate approssimative (centro paese):
 * nella Fase 1 vanno sostituite con l'elenco ufficiale dei comuni e il geocoding di swisstopo.
 */
export const COMUNI: Comune[] = [
  { id: 'lugano', name: 'Lugano', cap: '6900', district: 'Lugano', lat: 46.0037, lon: 8.9511, aliases: ['luganese'] },
  { id: 'massagno', name: 'Massagno', cap: '6900', district: 'Lugano', lat: 46.0129, lon: 8.9433 },
  { id: 'paradiso', name: 'Paradiso', cap: '6900', district: 'Lugano', lat: 45.9889, lon: 8.9456 },
  { id: 'viganello', name: 'Viganello', cap: '6962', district: 'Lugano', lat: 46.0115, lon: 8.9686 },
  { id: 'canobbio', name: 'Canobbio', cap: '6952', district: 'Lugano', lat: 46.0359, lon: 8.9661 },
  { id: 'savosa', name: 'Savosa', cap: '6942', district: 'Lugano', lat: 46.0204, lon: 8.949 },
  { id: 'agno', name: 'Agno', cap: '6982', district: 'Lugano', lat: 45.9993, lon: 8.9015 },
  { id: 'bioggio', name: 'Bioggio', cap: '6934', district: 'Lugano', lat: 46.013, lon: 8.909 },
  { id: 'capriasca', name: 'Capriasca', cap: '6950', district: 'Lugano', lat: 46.068, lon: 8.965, aliases: ['tesserete'] },
  { id: 'melide', name: 'Melide', cap: '6815', district: 'Lugano', lat: 45.955, lon: 8.948 },
  { id: 'bellinzona', name: 'Bellinzona', cap: '6500', district: 'Bellinzona', lat: 46.1946, lon: 9.0244, aliases: ['bellinzonese'] },
  { id: 'giubiasco', name: 'Giubiasco', cap: '6512', district: 'Bellinzona', lat: 46.1727, lon: 9.0067 },
  { id: 'arbedo-castione', name: 'Arbedo-Castione', cap: '6517', district: 'Bellinzona', lat: 46.2118, lon: 9.0447, aliases: ['arbedo', 'castione'] },
  { id: 'sant-antonino', name: "Sant'Antonino", cap: '6592', district: 'Bellinzona', lat: 46.153, lon: 8.979 },
  { id: 'cadenazzo', name: 'Cadenazzo', cap: '6593', district: 'Bellinzona', lat: 46.152, lon: 8.948 },
  { id: 'locarno', name: 'Locarno', cap: '6600', district: 'Locarno', lat: 46.1708, lon: 8.7995, aliases: ['locarnese'] },
  { id: 'muralto', name: 'Muralto', cap: '6600', district: 'Locarno', lat: 46.1736, lon: 8.803 },
  { id: 'minusio', name: 'Minusio', cap: '6648', district: 'Locarno', lat: 46.1775, lon: 8.8146 },
  { id: 'ascona', name: 'Ascona', cap: '6612', district: 'Locarno', lat: 46.1572, lon: 8.772 },
  { id: 'losone', name: 'Losone', cap: '6616', district: 'Locarno', lat: 46.169, lon: 8.759 },
  { id: 'tenero-contra', name: 'Tenero-Contra', cap: '6598', district: 'Locarno', lat: 46.18, lon: 8.85, aliases: ['tenero'] },
  { id: 'gordola', name: 'Gordola', cap: '6596', district: 'Locarno', lat: 46.183, lon: 8.866 },
  { id: 'mendrisio', name: 'Mendrisio', cap: '6850', district: 'Mendrisio', lat: 45.8706, lon: 8.9817, aliases: ['mendrisiotto'] },
  { id: 'chiasso', name: 'Chiasso', cap: '6830', district: 'Mendrisio', lat: 45.832, lon: 9.031 },
  { id: 'balerna', name: 'Balerna', cap: '6828', district: 'Mendrisio', lat: 45.846, lon: 9.006 },
  { id: 'stabio', name: 'Stabio', cap: '6855', district: 'Mendrisio', lat: 45.849, lon: 8.936 },
  { id: 'biasca', name: 'Biasca', cap: '6710', district: 'Riviera', lat: 46.3597, lon: 8.97 },
  { id: 'riviera', name: 'Riviera', cap: '6703', district: 'Riviera', lat: 46.31, lon: 9.01, aliases: ['osogna', 'claro', 'cresciano'] },
  { id: 'acquarossa', name: 'Acquarossa', cap: '6716', district: 'Blenio', lat: 46.455, lon: 8.939 },
  { id: 'faido', name: 'Faido', cap: '6760', district: 'Leventina', lat: 46.477, lon: 8.797 },
  { id: 'airolo', name: 'Airolo', cap: '6780', district: 'Leventina', lat: 46.5285, lon: 8.6086 },
  { id: 'maggia', name: 'Maggia', cap: '6673', district: 'Vallemaggia', lat: 46.249, lon: 8.707 },
  { id: 'cevio', name: 'Cevio', cap: '6675', district: 'Vallemaggia', lat: 46.318, lon: 8.602 },
];

const BY_ID = new Map(COMUNI.map((c) => [c.id, c]));

export function getComune(id: string): Comune | undefined {
  return BY_ID.get(id);
}

/** Nomi normalizzati, dal più lungo al più corto, così "sant antonino" vince su nomi più brevi. */
const NAME_INDEX: Array<{ needle: string; comune: Comune }> = COMUNI.flatMap((c) =>
  [c.name, ...(c.aliases ?? [])].map((n) => ({ needle: normalize(n), comune: c })),
).sort((a, b) => b.needle.length - a.needle.length);

/** Cerca il nome di una località dentro un testo già normalizzato. */
export function findComuneIn(normalizedText: string): { comune: Comune; needle: string } | null {
  const padded = ` ${normalizedText} `;
  for (const entry of NAME_INDEX) {
    if (padded.includes(` ${entry.needle} `)) return entry;
  }
  return null;
}

/** Risolve un nome scritto da una persona o da un agente ("Bellinzona", "a Locarno"). */
export function resolveComune(name: string | undefined | null): Comune | undefined {
  if (!name) return undefined;
  return findComuneIn(normalize(name))?.comune;
}

/** Distanza in linea d'aria, in km. */
export function distanceKm(a: Comune, b: Comune): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Comuni che corrispondono a quello che si sta scrivendo: nome, frazione (alias) o CAP,
 * senza badare ad accenti e maiuscole. Prima chi comincia così, poi chi lo contiene; a campo vuoto tutti.
 */
export function searchComuni(query: string, limit = COMUNI.length): Comune[] {
  const q = normalize(query);
  const byName = (a: Comune, b: Comune) => a.name.localeCompare(b.name, 'it');
  if (!q) return [...COMUNI].sort(byName).slice(0, limit);
  const scored: Array<{ c: Comune; score: number }> = [];
  for (const c of COMUNI) {
    const name = normalize(c.name);
    const aliases = (c.aliases ?? []).map(normalize);
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q) || c.cap.startsWith(q)) score = 1;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 2;
    else if (aliases.some((a) => a.startsWith(q))) score = 3;
    else if (name.includes(q) || aliases.some((a) => a.includes(q))) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  return scored.sort((a, b) => a.score - b.score || byName(a.c, b.c)).slice(0, limit).map((s) => s.c);
}
