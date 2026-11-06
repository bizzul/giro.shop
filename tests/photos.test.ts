import { describe, expect, it } from 'vitest';
import { makeCover, moveItem, planPhotoOrder } from '../src/core/photos.ts';

describe('ordine delle foto', () => {
  it('sposta e sceglie la copertina', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(makeCover(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('accetta foto salvate e nuove nell\'ordine scelto', () => {
    const plan = planPhotoOrder(['n:0', 'e:u/l/0.jpg', 'n:1'], ['u/l/0.jpg', 'u/l/1.jpg'], 2);
    expect(plan).toEqual({
      ok: true,
      slots: [
        { kind: 'new', fileIndex: 0 },
        { kind: 'existing', path: 'u/l/0.jpg' },
        { kind: 'new', fileIndex: 1 },
      ],
    });
  });

  it('chiede almeno una foto e al massimo cinque', () => {
    expect(planPhotoOrder([], ['a'], 0)).toEqual({ ok: false, error: 'Serve almeno una foto.' });
    expect(planPhotoOrder(['n:0', 'n:1', 'n:2', 'n:3', 'n:4', 'n:5'], [], 6).ok).toBe(false);
  });

  it('rifiuta foto sconosciute, file mancanti e doppioni', () => {
    expect(planPhotoOrder(['e:altro-utente/x.jpg'], ['u/l/0.jpg'], 0).ok).toBe(false);
    expect(planPhotoOrder(['n:3'], [], 1).ok).toBe(false);
    expect(planPhotoOrder(['e:u/l/0.jpg', 'e:u/l/0.jpg'], ['u/l/0.jpg'], 0).ok).toBe(false);
  });
});
