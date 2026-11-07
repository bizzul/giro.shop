import { describe, expect, it } from 'vitest';
import { formatPickup, nextSlots, zurichToIso } from '../src/core/pickup.ts';

describe('ritiro in ora svizzera', () => {
  it('dal modulo all\'istante, con ora solare e legale', () => {
    expect(zurichToIso('2026-11-14', '10:00')).toBe('2026-11-14T09:00:00.000Z');
    expect(zurichToIso('2026-07-04', '10:00')).toBe('2026-07-04T08:00:00.000Z');
    expect(zurichToIso('14.11.2026', '10:00')).toBeNull();
    expect(zurichToIso('2026-11-14', '10')).toBeNull();
  });

  it('oggi, domani e il giorno con il nome', () => {
    const now = new Date('2026-11-12T08:00:00Z'); // giovedì
    expect(formatPickup('2026-11-12T17:30:00Z', now)).toBe('oggi alle 18:30');
    expect(formatPickup('2026-11-13T17:30:00Z', now)).toBe('domani alle 18:30');
    expect(formatPickup('2026-11-14T09:00:00Z', now)).toBe('sabato 14 novembre alle 10:00');
  });

  it('i prossimi orari liberi: uno per giorno, almeno 12 ore dopo', () => {
    const now = new Date('2026-11-12T08:00:00Z'); // giovedì mattina
    expect(nextSlots(['sab-mattina', 'sere'], now)).toEqual([
      '2026-11-13T17:30:00.000Z', // venerdì sera
      '2026-11-14T09:00:00.000Z', // sabato mattina
      '2026-11-16T17:30:00.000Z', // lunedì sera
    ]);
    // Giovedì sera è a meno di 12 ore: si parte da venerdì
    expect(nextSlots(['sere'], now, 1)).toEqual(['2026-11-13T17:30:00.000Z']);
    expect(nextSlots([], now)).toEqual([]);
  });
});
