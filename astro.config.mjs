// @ts-check
import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // Tutte le pagine sono rese dal server; le più visitate restano in cache.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  cache: {
    provider: memoryCache(),
  },
  routeRules: {
    '/': { maxAge: 30, swr: 120 },
    '/annuncio/[id]': { maxAge: 60, swr: 300 },
    '/venditore/[id]': { maxAge: 60, swr: 300 },
  },
});
