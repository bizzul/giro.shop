import { defineConfig, devices } from '@playwright/test';

/**
 * Test nel browser (Playwright) con il Chrome installato sul computer: niente browser da scaricare.
 * Servono `supabase start` (database ed email locali, Mailpit) e il server di sviluppo:
 * se non è già acceso su 4321 lo avvia Playwright.
 * Uso: pnpm test:e2e   (oppure pnpm test:e2e --headed per vederlo)
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4321',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    locale: 'it-CH',
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
