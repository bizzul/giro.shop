import { describe, expect, it } from 'vitest';
import { formatSwissMobile, maskSwissMobile, normalizeSwissMobile } from '../src/core/phone.ts';

describe('natel svizzeri', () => {
  it('accetta i formati più comuni', () => {
    for (const input of ['079 123 45 67', '0791234567', '+41 79 123 45 67', '0041791234567', '41791234567', '+41 (0)79 123 45 67'.replace('(0)', '')]) {
      expect(normalizeSwissMobile(input)).toBe('+41791234567');
    }
    expect(normalizeSwissMobile('076 111 22 33')).toBe('+41761112233');
  });

  it('rifiuta numeri fissi, esteri o incompleti', () => {
    expect(normalizeSwissMobile('091 123 45 67')).toBeNull(); // fisso di Lugano
    expect(normalizeSwissMobile('+39 347 123 4567')).toBeNull();
    expect(normalizeSwissMobile('079 123 45')).toBeNull();
    expect(normalizeSwissMobile('')).toBeNull();
  });

  it('formatta e nasconde il numero', () => {
    expect(formatSwissMobile('+41791234567')).toBe('+41 79 123 45 67');
    expect(maskSwissMobile('+41791234567')).toBe('+41 79 *** ** 67');
  });
});
