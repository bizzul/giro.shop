import { describe, expect, it } from 'vitest';
import { HSTS, SECURITY_HEADERS, withSecurityHeaders } from '../src/lib/security-headers.ts';

describe('intestazioni di sicurezza', () => {
  it('le mette tutte, con HSTS solo su https', () => {
    const https = withSecurityHeaders(new Response('ok'), new URL('https://giro.shop/'));
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) expect(https.headers.get(key)).toBe(value);
    expect(https.headers.get('Strict-Transport-Security')).toBe(HSTS);
    expect(https.headers.get('Permissions-Policy')).toContain('geolocation=(self)');

    const http = withSecurityHeaders(new Response('ok'), new URL('http://localhost:4321/'));
    expect(http.headers.get('Strict-Transport-Security')).toBeNull();
    expect(http.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('lascia quelle già messe da una pagina', () => {
    const page = new Response('ok', { headers: { 'Content-Security-Policy': "frame-ancestors 'self'" } });
    expect(withSecurityHeaders(page, new URL('https://giro.shop/')).headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
  });

  it('aggiunge il divieto di cornici alla CSP della pagina', () => {
    const page = new Response('ok', { headers: { 'Content-Security-Policy': "script-src 'self'" } });
    expect(withSecurityHeaders(page, new URL('https://giro.shop/')).headers.get('Content-Security-Policy')).toBe("script-src 'self'; frame-ancestors 'none'");
  });

  it('funziona anche con intestazioni non modificabili, senza perdere stato e corpo', async () => {
    const redirect = Response.redirect('https://giro.shop/accedi', 303);
    const out = withSecurityHeaders(redirect, new URL('https://giro.shop/'));
    expect(out.status).toBe(303);
    expect(out.headers.get('Location')).toBe('https://giro.shop/accedi');
    expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
