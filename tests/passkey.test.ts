import { describe, expect, it } from 'vitest';
import { MAX_PASSKEYS, passkeyErrorMessage, passkeyName } from '../src/core/passkey.ts';
import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/webauthn.ts';

describe('passkeyName', () => {
  it('riconosce dispositivo e browser', () => {
    expect(passkeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1')).toBe(
      'iPhone · Safari',
    );
    expect(passkeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36')).toBe('Mac · Chrome');
    expect(passkeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0')).toBe(
      'Windows · Edge',
    );
    expect(passkeyName('Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(passkeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:145.0) Gecko/20100101 Firefox/145.0')).toBe('Mac · Firefox');
    expect(passkeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1')).toBe(
      'iPhone · Chrome',
    );
  });

  it('senza indizi resta «Passkey»', () => {
    expect(passkeyName(null)).toBe('Passkey');
    expect(passkeyName('curl/8.7.1')).toBe('Passkey');
  });
});

describe('passkeyErrorMessage', () => {
  it('spiega i casi che capitano davvero', () => {
    expect(passkeyErrorMessage('webauthn_credential_not_found')).toMatch(/link via email/);
    expect(passkeyErrorMessage('webauthn_challenge_expired')).toMatch(/troppo tempo/);
    expect(passkeyErrorMessage('too_many_passkeys')).toContain(String(MAX_PASSKEYS));
    expect(passkeyErrorMessage(undefined, 429)).toMatch(/Troppi tentativi/);
    expect(passkeyErrorMessage('qualcosa_di_nuovo')).toBe('Non è andata: riprova.');
  });
});

describe('base64url', () => {
  it('va e torna senza perdere byte, senza + / =', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = bytesToBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect([...base64UrlToBytes(text)]).toEqual([...bytes]);
    // Lunghezze che in base64 avrebbero 1 o 2 caratteri di riempimento
    for (const n of [1, 2, 3, 31, 32]) expect(base64UrlToBytes(bytesToBase64Url(bytes.slice(0, n))).length).toBe(n);
  });

  it('legge la sfida di Supabase', () => {
    expect(base64UrlToBytes('W0sj4OrHFUoseayZIR0_t8t1NOqvfKHmiKOneGBMMIs').length).toBe(32);
  });
});
