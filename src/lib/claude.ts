/** La chiave API di Claude, se c'è: le funzioni AI del sito si accendono solo con questa. */
export function claudeKey(): string | undefined {
  return import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

/** Limite semplice per indirizzo IP, in memoria: protegge le funzioni che costano (foto, traduzioni). */
const hits = new Map<string, number[]>();
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
