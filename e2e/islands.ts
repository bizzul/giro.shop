import { expect, type Page } from '@playwright/test';

/**
 * Aspetta che l'isola Preact sia attiva prima di usarla: con il server di sviluppo appena acceso la prima
 * compilazione richiede qualche secondo e un file scelto prima andrebbe perso. Astro toglie «ssr» quando l'ha idratata.
 */
export async function hydrated(page: Page, component: string) {
  await expect(page.locator(`astro-island[component-url*="${component}"]:not([ssr])`).first()).toBeAttached({ timeout: 30_000 });
}
