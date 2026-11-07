import { defineConfig, devices } from '@playwright/test';

/**
 * Test nel browser (Playwright) con il Chrome installato sul computer: niente browser da scaricare.
 * Serve `supabase start` (database ed email locali, Mailpit). Il server lo avvia Playwright: un server di sviluppo
 * tutto suo sulla porta 4322, accanto a quello di tutti i giorni sulla 4321 (--ignore-lock), e senza chiave di Claude
 * anche se è nel .env: bozze, assistente venditore e Svuota casa vanno con le regole, sempre uguali e senza costi.
 * Se è già acceso sulla 4322 lo riusa. Con E2E_BASE_URL si provano invece un server o un sito già acceso.
 * Uso: pnpm test:e2e   (oppure pnpm test:e2e --headed per vederlo)
 */
const PORT = 4322;
const LOCAL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? LOCAL,
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    locale: 'it-CH',
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec astro dev --ignore-lock --port ${PORT}`,
        url: LOCAL,
        reuseExistingServer: true,
        timeout: 120_000,
        // Vuota vince sul .env: il sito gira senza Claude
        env: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', NODE_OPTIONS: '--max-http-header-size=65536' },
      },
});
