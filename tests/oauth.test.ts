import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALL_SCOPES, parseScopes, pkceMatches, protectedResourceMetadata, resourceMatches, validRedirectUri } from '../src/core/oauth.ts';
import { checkImageUrl, isPrivateAddress, sniffImage } from '../src/lib/fetch-image.ts';

describe('OAuth del connettore', () => {
  it('PKCE S256', () => {
    const verifier = 'a'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches('b'.repeat(43), challenge)).toBe(false);
    // Troppo corto per lo standard
    expect(pkceMatches('abc', createHash('sha256').update('abc').digest('base64url'))).toBe(false);
  });

  it('indirizzi di ritorno', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(validRedirectUri('com.example.app:/callback')).toBe(true);
    expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    expect(validRedirectUri('https://claude.ai/cb#frammento')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
    expect(validRedirectUri('data:text/html,ciao')).toBe(false);
    expect(validRedirectUri('non un indirizzo')).toBe(false);
  });

  it('permessi', () => {
    expect(parseScopes(null)).toEqual(ALL_SCOPES);
    expect(parseScopes('ricerche')).toEqual(['ricerche']);
    expect(parseScopes('ricerche admin ricerche')).toEqual(['ricerche']);
    expect(parseScopes('admin')).toEqual(ALL_SCOPES);
  });

  it('risorsa (RFC 8707)', () => {
    const r = 'https://giro.shop/mcp/account';
    expect(resourceMatches(undefined, r)).toBe(true);
    expect(resourceMatches('https://giro.shop/mcp/account/', r)).toBe(true);
    expect(resourceMatches('https://giro.shop/mcp', r)).toBe(false);
    expect(resourceMatches('https://altro.example/mcp/account', r)).toBe(false);
    expect(protectedResourceMetadata('https://giro.shop').resource).toBe(r);
  });
});

describe('foto da indirizzi dati da un assistente', () => {
  it('niente reti interne', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '151.101.1.1', '2a00:1450:4001::1']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('solo https pubblici', () => {
    expect(() => checkImageUrl('http://example.com/a.jpg')).toThrow('https');
    expect(() => checkImageUrl('https://127.0.0.1/a.jpg')).toThrow('non ammesso');
    expect(() => checkImageUrl('https://localhost/a.jpg')).toThrow('non ammesso');
    expect(() => checkImageUrl('https://metadata.google.internal/a')).toThrow('non ammesso');
    expect(() => checkImageUrl('https://example.com:8443/a.jpg')).toThrow('porta');
    expect(checkImageUrl('https://example.com/a.jpg').hostname).toBe('example.com');
  });

  it('il formato si riconosce dai byte, non dal nome', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('89504e470d0a1a0a0000', 'hex'))).toBe('image/png');
    expect(sniffImage(Buffer.from('RIFF0000WEBPVP8 ', 'ascii'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<html>ciao</html>'))).toBeNull();
  });
});

describe('moduli da altri siti', async () => {
  const { isCrossSiteForm } = await import('../src/lib/origin-check.ts');
  const req = (path: string, headers: Record<string, string>, method = 'POST') =>
    [new Request(`http://localhost:4321${path}`, { method, headers }), new URL(`http://localhost:4321${path}`)] as const;

  it('rifiuta i moduli da altre origini, come Astro', () => {
    expect(isCrossSiteForm(...req('/miei-annunci?_action=account.deleteAccount', { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }))).toBe(true);
    expect(isCrossSiteForm(...req('/_actions/account.deleteAccount', { 'content-type': 'multipart/form-data; boundary=x', 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });

  it('lascia passare lo stesso sito, i GET, il JSON e chi non manda Origin', () => {
    expect(isCrossSiteForm(...req('/miei-annunci', { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:4321' }))).toBe(false);
    expect(isCrossSiteForm(...req('/miei-annunci', { 'sec-fetch-site': 'same-origin', 'content-type': 'multipart/form-data' }))).toBe(false);
    expect(isCrossSiteForm(...req('/cerca', { origin: 'https://evil.example' }, 'GET'))).toBe(false);
    expect(isCrossSiteForm(...req('/mcp/account', { 'content-type': 'application/json', origin: 'http://localhost:6274' }))).toBe(false);
    expect(isCrossSiteForm(...req('/email-avvisi', { 'content-type': 'application/x-www-form-urlencoded' }))).toBe(false);
  });

  it('gli endpoint OAuth dei token accettano client nel browser', () => {
    expect(isCrossSiteForm(...req('/oauth/token', { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:6274' }))).toBe(false);
    expect(isCrossSiteForm(...req('/oauth/revoke', { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    // Il consenso invece no: lo decide solo la persona, dalla pagina stessa
    expect(isCrossSiteForm(...req('/oauth/authorize', { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }))).toBe(true);
  });
});
