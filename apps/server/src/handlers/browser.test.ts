import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import type { BrowserManager } from '../browser/manager.ts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerBrowserHandlers } from './browser.ts';

const openRequest = JSON.stringify({
    id: 'open',
    type: 'browser.open',
    payload: { browserId: 'view-1', url: 'https://example.com', width: 800, height: 600 }
});

describe('browser handlers', () => {
    test('the machine policy refuses opening a stream before a browser is created', async () => {
        let allowed = false;
        let opened = 0;
        const browsers = {
            async open() {
                opened += 1;
                return {
                    browserId: 'view-1',
                    url: 'https://example.com',
                    title: 'Example',
                    loading: false,
                    canGoBack: false,
                    canGoForward: false,
                    error: null,
                    streamId: 'browser:view-1'
                };
            }
        } as unknown as BrowserManager;
        const dispatcher = new Dispatcher();
        registerBrowserHandlers(dispatcher, browsers, () => allowed);
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };

        await dispatcher.handle(client, openRequest);
        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'streaming-disabled' } });
        expect(opened).toBe(0);

        allowed = true;
        await dispatcher.handle(client, openRequest);
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { streamId: 'browser:view-1' } });
        expect(opened).toBe(1);
    });
});
