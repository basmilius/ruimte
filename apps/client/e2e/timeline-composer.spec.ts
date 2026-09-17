import { expect, test, type Page } from '@playwright/test';

const mount = async (page: Page, count = 40) => {
    const timelineSource = await (await page.request.get('/src/chat/ui/Timeline.tsx')).text();
    const mainSource = await (await page.request.get('/src/main.tsx')).text();
    const scrollingUrl = timelineSource.match(/from "([^"]*\/chat\/timeline-scroll\.ts[^"]*)"/)![1];
    const reactUrl = timelineSource.match(/from "([^" ]*\/react\.js[^" ]*)"/)![1];
    const domUrl = mainSource.match(/from "([^" ]*\/react-dom_client\.js[^" ]*)"/)![1];
    await page.route('**/__timeline-composer-check', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body>
                <div id="fixture" class="chat-column" style="display:flex;width:760px;height:600px;margin:24px;position:relative"></div>
                <script type="module">
                    const refresh = (await import('/@react-refresh')).default;
                    refresh.injectIntoGlobalHook(window);
                    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
                    window.__vite_plugin_react_preamble_installed__ = true;
                    const React = (await import('${reactUrl}')).default;
                    const { createRoot } = (await import('${domUrl}')).default;
                    const { Timeline } = await import('/src/chat/ui/Timeline.tsx');
                    const { useChats } = await import('/src/state/chats.ts');
                    const { useEndpoints } = await import('/src/state/endpoints.ts');
                    const { endpointKey } = await import('/src/state/keys.ts');
                    const { scrollTimelineToEnd, pageTimeline } = await import('${scrollingUrl}');
                    const chatId = 'scroll-fixture';
                    const key = endpointKey(useEndpoints.getState().activeId, chatId);
                    const info = { provider: 'codex', cwd: '/fixture', selection: { model: 'test' }, activeTurnId: null };
                    const items = Array.from({ length: ${count} }, (_, index) => ({
                        id: 'message-' + index, kind: 'user', createdAt: index, turnId: 'turn-' + index,
                        text: 'Message ' + index + '. A conversation with enough content to scroll and read back.'
                    }));
                    useChats.getState().reset(key, info, items);
                    window.appendMessage = () => {
                        const index = items.length;
                        const item = { id: 'message-' + index, kind: 'user', createdAt: index, turnId: 'turn-' + index, text: 'New reply' };
                        items.push(item);
                        useChats.getState().apply(key, { type: 'item', item });
                    };
                    window.jumpToEnd = () => scrollTimelineToEnd(chatId);
                    window.pageUp = () => pageTimeline(chatId, -1);
                    function Harness() {
                        const [height, setHeight] = React.useState(100);
                        window.resizeComposer = setHeight;
                        return React.createElement(Timeline, { chatId, composer:
                            React.createElement('div', { 'data-testid': 'composer', className: 'chat-column-content bg-surface-raised', style: { height } },
                                React.createElement('span', null, 'Composer controls'),
                                React.createElement('textarea', { 'aria-label': 'Draft', defaultValue: 'Keep this draft' }))
                        });
                    }
                    createRoot(document.getElementById('fixture')).render(React.createElement(Harness));
                </script></body></html>`
        })
    );
    await page.goto('/__timeline-composer-check');
    await expect(page.getByTestId('composer')).toBeVisible();
};

const resize = (page: Page, height: number) =>
    page.evaluate((height) => (window as unknown as { resizeComposer(height: number): void }).resizeComposer(height), height);
const atEnd = (page: Page) => page.locator('.chat-scroll').evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
const lastMessageClearsComposer = async (page: Page, id: string) => {
    await expect.poll(() => atEnd(page)).toBeLessThanOrEqual(1);
    const message = page.locator(`[data-item-id="${id}"]`);
    await expect(message).toBeVisible();
    await expect
        .poll(() =>
            message.evaluate((element) => {
                const composer = document.querySelector('[data-testid="composer"]')!;
                return element.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top;
            })
        )
        .toBe(true);
};

test('growing and shrinking the composer keeps the last message above it', async ({ page }) => {
    await mount(page);
    await lastMessageClearsComposer(page, 'message-39');
    for (const height of [380, 180, 440, 100]) {
        await resize(page, height);
        await expect(page.getByTestId('composer')).toHaveCSS('height', `${height}px`);
        await lastMessageClearsComposer(page, 'message-39');
    }
    await page.evaluate(() => (window as unknown as { appendMessage(): void }).appendMessage());
    await lastMessageClearsComposer(page, 'message-40');
});

test('resizing while reading history preserves the scroll position, then jump reaches the end', async ({ page }) => {
    await mount(page);
    const scroll = page.locator('.chat-scroll');
    await lastMessageClearsComposer(page, 'message-39');
    await scroll.evaluate((element) => {
        element.scrollTop = 600;
    });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(600);
    await resize(page, 380);
    await expect(page.getByTestId('composer')).toHaveCSS('height', '380px');
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(600);
    await page.evaluate(() => (window as unknown as { jumpToEnd(): void }).jumpToEnd());
    await lastMessageClearsComposer(page, 'message-39');
});

test('a composer taller than the viewport is scrollable from top to bottom', async ({ page }) => {
    await mount(page);
    await resize(page, 760);
    await expect(page.getByTestId('composer').locator('..')).toHaveCSS('position', 'relative');
    const scroll = page.locator('.chat-scroll');
    await expect.poll(() => atEnd(page)).toBeLessThanOrEqual(1);
    const end = await page.getByTestId('composer').boundingBox();
    const viewport = await scroll.boundingBox();
    expect(end!.y + end!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
    await scroll.evaluate((element) => {
        element.scrollTop -= 300;
    });
    await expect.poll(async () => (await page.getByTestId('composer').boundingBox())!.y).toBeGreaterThanOrEqual(viewport!.y);
});

test('the first message keeps the mounted draft and does not leave empty clearance', async ({ page }) => {
    await mount(page, 0);
    const input = page.getByRole('textbox', { name: 'Draft' });
    await input.fill('Draft before the first reply');
    await input.focus();
    await page.evaluate(() => (window as unknown as { appendMessage(): void }).appendMessage());
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Draft before the first reply');
    await lastMessageClearsComposer(page, 'message-0');
});

test('PageUp moves by the visible conversation height above the composer', async ({ page }) => {
    await mount(page);
    await resize(page, 380);
    await lastMessageClearsComposer(page, 'message-39');
    const scroll = page.locator('.chat-scroll');
    const before = await scroll.evaluate((element) => element.scrollTop);
    const distance = await scroll.evaluate((element) => (element.clientHeight - Number.parseFloat(getComputedStyle(element).scrollPaddingBottom)) * 0.9);
    await page.evaluate(() => (window as unknown as { pageUp(): void }).pageUp());
    await expect.poll(async () => Math.abs((await scroll.evaluate((element) => element.scrollTop)) - (before - distance))).toBeLessThanOrEqual(1);
});

test('select all in the conversation excludes the composer', async ({ page }) => {
    await mount(page);
    await lastMessageClearsComposer(page, 'message-39');
    await page.locator('[data-item-id="message-39"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select all', exact: true }).click();
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected).toContain('Message 39');
    expect(selected).not.toContain('Composer controls');
});
