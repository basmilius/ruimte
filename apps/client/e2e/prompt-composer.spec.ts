import { expect, test, type Page } from '@playwright/test';

const mount = async (page: Page) => {
    const composerSource = await (await page.request.get('/src/chat/ui/PromptComposer.tsx')).text();
    const mainSource = await (await page.request.get('/src/main.tsx')).text();
    const reactUrl = composerSource.match(/from "([^" ]*\/react\.js[^" ]*)"/)![1];
    const domUrl = mainSource.match(/from "([^" ]*\/react-dom_client\.js[^" ]*)"/)![1];
    await page.route(/\/src\/chat\/index\.ts(?:\?.*)?$/, (route) =>
        route.fulfill({
            contentType: 'text/javascript',
            body: `window.promptCalls = []; window.promptFailure = false; export const chatClient = Object.fromEntries(['approve', 'answer', 'dismiss'].map(name => [name, async (...args) => { if (window.promptFailure) { throw new Error("Could not send answer"); } window.promptCalls.push({ name, args }); }]));`
        })
    );
    await page.route('**/__prompt-composer-check', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: `
        <!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body>
        <div id="fixture" style="max-width:760px;margin:32px auto;border-radius:24px;background:var(--surface-raised)"></div>
        <script type="module">
            const refresh = (await import('/@react-refresh')).default;
            refresh.injectIntoGlobalHook(window);
            window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
            window.__vite_plugin_react_preamble_installed__ = true;
            const React = (await import('${reactUrl}')).default;
            const { createRoot } = (await import('${domUrl}')).default;
            const { PromptComposer } = await import('/src/chat/ui/PromptComposer.tsx');
            const { PROMPT_SAMPLES } = await import('/src/prompts/logic/prompts.fixtures.ts');
            function Harness() {
                const [pending, setPending] = React.useState([]);
                window.showLivePrompt = index => setPending(PROMPT_SAMPLES[index].items);
                window.showPrompt = label => setPending(PROMPT_SAMPLES.find(sample => sample.label === label).items);
                window.clearLivePrompts = () => setPending([]);
                return React.createElement(PromptComposer, {
                    chatId: 'prompt-test', pending, focused: true, disabled: false, hasDraft: true, denyReason: true,
                    onAllAnswered: () => document.querySelector('.composer-input').focus()
                }, React.createElement('textarea', { className: 'composer-input', defaultValue: 'Keep this draft', 'aria-label': 'Chat draft', style: { padding: '20px', width: '100%' } }));
            }
            createRoot(document.getElementById('fixture')).render(React.createElement(Harness));
        </script></body></html>`
        })
    );
    await page.goto('/__prompt-composer-check');
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toBeVisible();
};
const choose = async (page: Page, label: string) => {
    await page.evaluate((label) => (window as unknown as { showPrompt(label: string): void }).showPrompt(label), label);
};
const calls = (page: Page) => page.evaluate(() => (window as unknown as { promptCalls: unknown[] }).promptCalls);

test.beforeEach(async ({ page }) => mount(page));

test('approval sends the decision and restores the draft', async ({ page }) => {
    await choose(page, 'Permission · File edit');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Permission request' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toHaveValue('Keep this draft');
    expect(await calls(page)).toMatchObject([{ name: 'approve', args: expect.arrayContaining(['allow']) }]);
});

test('a request takes over while typing; Escape and Enter on the heading do not decide', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Chat draft' }).focus();
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(0));
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toBeHidden();
    await expect(page.locator('.prompt-heading')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Back to draft' })).toHaveCount(0);
    await page.locator('.prompt-heading').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    expect(await calls(page)).toEqual([]);
    await page.getByRole('button', { name: 'Allow', exact: true }).dblclick();
    await expect.poll(async () => (await calls(page)).length).toBe(1);
});

test('a written answer and multi-selection survive navigating the questions', async ({ page }) => {
    await choose(page, 'Question · Three questions');
    await page.getByPlaceholder('Something else…', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeFocused();
    await expect(page.getByRole('group', { name: 'Question', exact: true }).getByRole('textbox')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Your answer' }).fill('Keep terminal separate');
    await page.getByRole('radio', { name: 'All three Chat, files and terminal' }).click();
    await page.getByPlaceholder('Something else…', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Keep terminal separate');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Type check Check all workspaces' }).click();
    await page.getByRole('checkbox', { name: 'Unit tests Run the targeted tests' }).click();
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Keep terminal separate');
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Keep terminal separate');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Type check Check all workspaces' })).toBeChecked();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your answer' }).fill('Run targeted tests');
    await page.getByRole('button', { name: 'Answer', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Question' })).toHaveCount(0);
    expect(await calls(page)).toMatchObject([
        {
            name: 'answer',
            args: expect.arrayContaining([
                expect.objectContaining({ endpoints: 'Keep terminal separate', checks: 'Type check, Unit tests', notes: 'Run targeted tests' })
            ])
        }
    ]);
});

test('failed answers can be retried without losing their text', async ({ page }) => {
    await choose(page, 'Question · Written answer');
    await page.getByRole('textbox', { name: 'Your answer' }).fill('Keep this answer');
    await page.evaluate(() => {
        (window as unknown as { promptFailure: boolean }).promptFailure = true;
    });
    await page.getByRole('button', { name: 'Answer', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not send answer');
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Keep this answer');
    await page.evaluate(() => {
        (window as unknown as { promptFailure: boolean }).promptFailure = false;
    });
    await page.getByRole('button', { name: 'Answer', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Question' })).toHaveCount(0);
    expect(await calls(page)).toMatchObject([{ name: 'answer' }]);
});

test('a blocking permission is first in a mixed queue', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(1));
    await choose(page, 'Several requests');
    await expect(page.getByRole('group', { name: 'Permission request' })).toBeVisible();
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Question' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0);
    expect(await calls(page)).toMatchObject([{ name: 'approve' }]);
});

test('prompt options and actions fit a narrow screen in both color schemes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
        }, colorScheme);
        await choose(page, 'Question · Single choice');
        const box = await page.getByRole('group', { name: 'Question' }).boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeVisible();
        await page.screenshot({ path: `/tmp/ruimte-prompt-web-${colorScheme}.png`, fullPage: true });
        await choose(page, 'Permission · Command');
        await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
        await page.screenshot({ path: `/tmp/ruimte-prompt-permission-${colorScheme}.png`, fullPage: true });
    }
});

test('a completed request does not hide a reused id after a chat reset', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(0));
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Permission request' })).toHaveCount(0);
    await page.evaluate(async () => {
        (window as unknown as { clearLivePrompts(): void }).clearLivePrompts();
        await new Promise(requestAnimationFrame);
    });
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toBeVisible();
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(0));
    await expect(page.getByRole('group', { name: 'Permission request' })).toBeVisible();
});

test('a denial reason keeps focus and is sent with Deny', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(1));
    await page.getByRole('button', { name: 'Add a reason', exact: true }).click();
    const reason = page.getByRole('textbox', { name: 'Reason for declining' });
    await expect(reason).toBeFocused();
    await reason.pressSequentially('Keep the current retry policy.');
    await expect(reason).toBeFocused();
    await expect(reason).toHaveValue('Keep the current retry policy.');
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    expect(await calls(page)).toMatchObject([{ name: 'approve', args: expect.arrayContaining(['deny', 'Keep the current retry policy.']) }]);
});

test('session approval shares the action row and sends its own decision', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(1));
    const session = page.getByRole('button', { name: 'Allow for this session', exact: true });
    const deny = await page.getByRole('button', { name: 'Deny', exact: true }).boundingBox();
    const allow = await page.getByRole('button', { name: 'Allow', exact: true }).boundingBox();
    const scope = await session.boundingBox();
    expect(scope!.y).toBe(deny!.y);
    expect(scope!.y).toBe(allow!.y);
    await expect(session).toHaveAccessibleDescription('Allow commands in this session until it ends.');
    await session.click();
    expect(await calls(page)).toMatchObject([{ name: 'approve', args: expect.arrayContaining(['allow-always']) }]);
});

test('choices are one list: arrows move, Enter picks and moves on, Space toggles, Enter answers', async ({ page }) => {
    await choose(page, 'Question · Three questions');
    await expect(page.locator('.prompt-heading')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'All three Chat, files and terminal' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeFocused();
    await expect(page.getByRole('radio', { name: 'All three Chat, files and terminal' })).not.toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('radio', { name: 'Only chat and files Keep terminal retries separate' })).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Question 2 of 3')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Type check Check all workspaces' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('checkbox', { name: 'Type check Check all workspaces' })).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await expect(page.getByRole('checkbox', { name: 'Unit tests Run the targeted tests' })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Question 3 of 3')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue('');
    await page.keyboard.type('First line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Question' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toBeFocused();
    expect(await calls(page)).toMatchObject([
        { name: 'answer', args: expect.arrayContaining([{ endpoints: 'All three', checks: 'Type check, Unit tests', notes: 'First line\nsecond' }]) }
    ]);
});

test('something else leaves upward from its start and sends on Enter', async ({ page }) => {
    await choose(page, 'Question · Single choice');
    await page.getByPlaceholder('Something else…', { exact: true }).click();
    await page.keyboard.type('Neither');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('radio', { name: 'Only chat and files Keep terminal retries separate' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Question' })).toHaveCount(0);
    expect(await calls(page)).toMatchObject([{ name: 'answer', args: expect.arrayContaining([{ endpoints: 'Neither' }]) }]);
});

test('the action row takes arrows and Mod+Enter allows from anywhere but the reason', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { showLivePrompt(index: number): void }).showLivePrompt(1));
    await expect(page.locator('.prompt-heading')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Add a reason', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Reason for declining' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Enter');
    expect(await calls(page)).toEqual([]);
    await page.locator('.prompt-heading').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toBeFocused();
    expect(await calls(page)).toMatchObject([{ name: 'approve', args: expect.arrayContaining(['allow']) }]);
});
