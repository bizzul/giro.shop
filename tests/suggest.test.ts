import { describe, expect, it } from 'vitest';
import { suggest } from '../src/core/suggest.ts';
import { publishedListings } from '../src/core/store.ts';

const s = (q: string) => suggest(q, publishedListings());

describe('suggest', () => {
  it("completa l'ultima parola con frasi che esistono negli annunci", () => {
    expect(s('scri')[0]).toBe('scrivania');
    expect(s('scrivania in no')).toContain('scrivania in noce');
    expect(s('poltrona in vel')).toContain('poltrona in velluto');
  });

  it('dopo "a", "vicino", "zona" propone solo comuni', () => {
    expect(s('bici a Bel')).toEqual(['bici a Bellinzona']);
    expect(s('sci zona Ai')).toEqual(['sci zona Airolo']);
  });

  it('tiene conto delle parole già scritte', () => {
    const giacca = s('giacca da sc');
    expect(giacca[0]).toBe('giacca da sci');
    expect(giacca).not.toContain('giacca da scrivania');
    // Se le parole scritte non aiutano, si guarda in tutti gli annunci
    expect(s('tavolo in le')).toContain('tavolo in legno');
  });

  it('unisce singolare e plurale e rispetta marche e sigle', () => {
    const scri = s('scri');
    expect(scri).not.toContain('scrivanie');
    expect(s('ip')).toContain('iPhone');
  });

  it('non propone niente dopo uno spazio o con meno di due lettere', () => {
    expect(s('divano ')).toEqual([]);
    expect(s('x')).toEqual([]);
    expect(s('')).toEqual([]);
  });
});
