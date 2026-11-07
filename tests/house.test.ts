import { describe, expect, it } from 'vitest';
import { cleanBox, houseDrafts } from '../src/core/house.ts';

describe('svuota casa', () => {
  it('i riquadri restano dentro la foto; troppo piccoli o quasi tutta la foto: nessun ritaglio', () => {
    expect(cleanBox({ x: 0.6, y: -0.1, width: 0.6, height: 0.5 })).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.5 });
    expect(cleanBox({ x: 0.2, y: 0.2, width: 0.05, height: 0.3 })).toBeNull();
    expect(cleanBox({ x: 0, y: 0, width: 0.97, height: 0.95 })).toBeNull();
  });

  it('senza Claude serve il testo sotto ogni foto', async () => {
    const image = { kind: 'url' as const, url: 'https://esempio.test/a.jpg' };
    const before = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(houseDrafts({ images: [image, image], hints: ['Divano grigio', ''] })).rejects.toThrow('sotto la foto 2');
      const out = await houseDrafts({ images: [image], hints: ['Divano angolare grigio, tre posti'] });
      expect(out.source).toBe('regole');
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).toMatchObject({ photo: 0, box: null, category: 'arredamento' });
    } finally {
      if (before) process.env.ANTHROPIC_API_KEY = before;
    }
  });
});
