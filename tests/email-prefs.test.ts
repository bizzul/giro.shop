import { describe, expect, it } from 'vitest';
import {
  digestCutoff,
  digestDue,
  emailRoute,
  groupByKey,
  groupIsOn,
  groupOf,
  offKindsFromGroups,
  prefsSummary,
  type EmailPrefs,
} from '../src/core/email-prefs.ts';

const prefs = (p: Partial<EmailPrefs>): EmailPrefs => ({ email_mode: 'subito', email_off: [], ...p });

describe('email degli avvisi', () => {
  it('senza preferenze: subito, per ogni tipo', () => {
    expect(emailRoute(null, 'ricerca')).toBe('subito');
    expect(emailRoute(prefs({}), 'valutazione')).toBe('subito');
  });

  it('riassunto: gli avvisi aspettano la sera, la moderazione no', () => {
    const p = prefs({ email_mode: 'riassunto' });
    expect(emailRoute(p, 'prezzo')).toBe('riassunto');
    expect(emailRoute(p, 'segnalazione')).toBe('subito');
    expect(emailRoute(p, 'contestazione')).toBe('subito');
  });

  it('mai: nessuna email, nemmeno di moderazione', () => {
    const p = prefs({ email_mode: 'mai' });
    expect(emailRoute(p, 'ricerca')).toBeNull();
    expect(emailRoute(p, 'segnalazione')).toBeNull();
  });

  it('un tipo spento non arriva, gli altri sì', () => {
    const p = prefs({ email_off: ['prezzo', 'venduto'] });
    expect(emailRoute(p, 'prezzo')).toBeNull();
    expect(emailRoute(p, 'venduto')).toBeNull();
    expect(emailRoute(p, 'domanda')).toBe('subito');
    // La moderazione non si spegne per tipo
    expect(emailRoute(prefs({ email_off: ['segnalazione'] }), 'segnalazione')).toBe('subito');
  });

  it('dai gruppi accesi ai tipi spenti', () => {
    expect(offKindsFromGroups(['ricerche', 'salvati', 'domande', 'valutazioni', 'scadenze'])).toEqual([]);
    expect(offKindsFromGroups(['ricerche', 'domande', 'valutazioni', 'scadenze'])).toEqual(['prezzo', 'venduto']);
    expect(offKindsFromGroups(['sconosciuto'])).toHaveLength(7);
  });

  it('gruppi e riepilogo', () => {
    expect(groupOf('risposta')?.key).toBe('domande');
    expect(groupOf('segnalazione')).toBeUndefined();
    expect(groupByKey('salvati')?.kinds).toEqual(['prezzo', 'venduto']);
    expect(groupIsOn(prefs({ email_off: ['venduto'] }), groupByKey('salvati')!)).toBe(false);
    expect(prefsSummary(null)).toBe('Email: subito');
    expect(prefsSummary(prefs({ email_mode: 'riassunto', email_off: ['ricerca'] }))).toBe('Email: un riassunto al giorno, 4 tipi su 5');
    expect(prefsSummary(prefs({ email_mode: 'mai' }))).toBe('Email spente');
  });

  it('il riassunto parte alle 18 svizzere, ora legale compresa', () => {
    // Inverno: UTC+1 → 17:00 UTC
    expect(digestCutoff(new Date('2026-11-06T10:00:00Z')).toISOString()).toBe('2026-11-06T17:00:00.000Z');
    // Estate: UTC+2 → 16:00 UTC
    expect(digestCutoff(new Date('2026-07-01T10:00:00Z')).toISOString()).toBe('2026-07-01T16:00:00.000Z');
  });

  it('una volta al giorno, dopo le 18', () => {
    const before = new Date('2026-11-06T16:30:00Z');
    const after = new Date('2026-11-06T17:05:00Z');
    expect(digestDue(before, null)).toBe(false);
    expect(digestDue(after, null)).toBe(true);
    expect(digestDue(after, new Date('2026-11-05T17:01:00Z'))).toBe(true);
    expect(digestDue(after, new Date('2026-11-06T17:01:00Z'))).toBe(false);
  });
});
