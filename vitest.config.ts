import { defineConfig } from 'vitest/config';

// I test unitari stanno in tests/; quelli nel browser (e2e/) li esegue Playwright
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
