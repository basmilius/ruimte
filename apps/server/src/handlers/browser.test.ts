import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import type { BrowserManager } from '../browser/manager.ts';
import { BrowserPages } from '../browser/pages.ts';
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
        registerBrowserHandlers(dispatcher, browsers, new BrowserPages(), () => allowed);
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

    test('the machine policy refuses driving a page that was already open', async () => {
        const calls: string[] = [];
        const browsers = {
            navigate(...args: unknown[]) {
                calls.push('navigate');
                return Promise.resolve(args);
            },
            command() {
                calls.push('command');
                return Promise.resolve({});
            },
            resize() {
                calls.push('resize');
                return Promise.resolve();
            },
            input() {
                calls.push('input');
                return Promise.resolve();
            }
        } as unknown as BrowserManager;
        const dispatcher = new Dispatcher();
        registerBrowserHandlers(dispatcher, browsers, new BrowserPages(), () => false);
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };

        const requests = [
            { id: 'navigate', type: 'browser.navigate', payload: { browserId: 'view-1', url: 'https://example.com' } },
            { id: 'command', type: 'browser.command', payload: { browserId: 'view-1', command: 'reload' } },
            { id: 'resize', type: 'browser.resize', payload: { browserId: 'view-1', width: 800, height: 600 } },
            { id: 'input', type: 'browser.input', payload: { browserId: 'view-1', input: { kind: 'text', text: 'hello' } } }
        ];
        for (const request of requests) {
            await dispatcher.handle(client, JSON.stringify(request));
        }

        expect(frames.map((frame) => frame)).toEqual(
            requests.map((request) => ({
                id: request.id,
                ok: false,
                error: { code: 'streaming-disabled', message: 'Browser and device streaming is disabled on this machine' }
            }))
        );
        expect(calls).toEqual([]);
    });
});
