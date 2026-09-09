import { defineConfig } from '@playwright/test';

/* Runs against a dev client that is already up (see e2e/terminal.spec.ts for the two commands). */
export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    reporter: 'list',
    use: {
        baseURL: process.env.RUIMTE_E2E_URL ?? 'http://localhost:5199',
        headless: true
    }
});
