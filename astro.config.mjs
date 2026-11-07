// @ts-check
import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Dietro un tunnel (Cloudflare → Mac mini) le richieste arrivano in http: con l'indirizzo pubblico in PIAZZA_BASE_URL
// Astro si fida di host e https inoltrati solo per quel dominio (Astro.url resta corretto, niente host falsificati).
const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const baseUrl = process.env.PIAZZA_BASE_URL ?? fileEnv.PIAZZA_BASE_URL;
const base = baseUrl ? new URL(baseUrl) : null;
const allowedDomains = base && base.protocol === 'https:' ? [{ hostname: base.hostname, protocol: 'https' }] : [];

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // Tutte le pagine sono rese dal server; le più visitate restano in cache.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  // Il controllo dei moduli da altri siti è nel middleware (src/lib/origin-check.ts), con le eccezioni OAuth
  security: { checkOrigin: false, allowedDomains },
  cache: {
    provider: memoryCache(),
  },
  routeRules: {
    '/': { maxAge: 30, swr: 120 },
    '/annuncio/[id]': { maxAge: 60, swr: 300 },
    '/venditore/[id]': { maxAge: 60, swr: 300 },
  },
});
