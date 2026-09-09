import { expect, test, type Page } from '@playwright/test';

/*
 * Needs the daemon and the client running:
 *   bun run dev:server
 *   bun run --cwd apps/client dev -- --port 5199
 * then `bunx playwright test` in apps/client (RUIMTE_E2E_URL overrides the client address).
 * The xterm text is read through the dev-only window.ruimte hooks: with the WebGL renderer
 * there is no text in the DOM to assert on.
 */

const NODE = 'term-1';
const MARKER = 'ruimte-e2e';

type Hooks = { ruimte?: { terminalText(id: string): string | null; terminalSize(id: string): { cols: number; rows: number } | null } };

const screenLines = (page: Page): Promise<string[]> =>
    page.evaluate((id) => ((window as unknown as Hooks).ruimte?.terminalText(id) ?? '').split('\n'), NODE);

const terminalSize = (page: Page): Promise<{ cols: number; rows: number } | null> =>
    page.evaluate((id) => (window as unknown as Hooks).ruimte?.terminalSize(id) ?? null, NODE);

/* The echoed command also contains the marker; only a line that is the marker alone is the shell's answer. */
const hasOutputLine = async (page: Page): Promise<boolean> => (await screenLines(page)).some((line) => line.trim() === MARKER);

const waitForPrompt = (page: Page): Promise<unknown> =>
    page.waitForFunction((id) => ((window as unknown as Hooks).ruimte?.terminalText(id) ?? '').trim().length > 0, NODE);

test('a shell keeps running and its screen survives a reload', async ({ page }) => {
    await page.goto('/');
    await waitForPrompt(page);

    await page.click(`[data-node-id="${NODE}"] [data-node-body]`);
    await page.keyboard.type(`echo ${MARKER}`);
    await page.keyboard.press('Enter');
    await expect.poll(() => hasOutputLine(page)).toBe(true);

    await page.reload();
    await waitForPrompt(page);
    await expect.poll(() => hasOutputLine(page)).toBe(true);
});

test('zooming the canvas does not change cols and rows', async ({ page }) => {
    await page.goto('/');
    await waitForPrompt(page);
    const before = await terminalSize(page);
    expect(before).not.toBeNull();

    await page.keyboard.press('Escape');
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await page.waitForTimeout(200);

    expect(await terminalSize(page)).toEqual(before);
});
