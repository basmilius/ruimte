import { describe, expect, test } from 'bun:test';
import type { BrowserInfo } from '@ruimte/contracts';
import { BrowserManager, type BrowserPage } from './manager.ts';
import { LiveStreamHub } from '../streams/live-stream.ts';

class FakePage implements BrowserPage {
    url = 'about:blank';
    title = '';
    loading = false;
    onNavigated: ((url: string, title?: string) => void) | null = null;
    onNavigationFailed: ((error: Error) => void) | null = null;
    readonly calls: Array<[string, Record<string, unknown> | undefined]> = [];
    private frameListener: ((event: MessageEvent<{ data: string; sessionId: number }>) => void) | null = null;

    addEventListener(_type: string, listener: (event: MessageEvent<{ data: string; sessionId: number }>) => void): void {
        this.frameListener = listener;
    }

    async navigate(url: string): Promise<void> {
        this.url = url;
        this.title = 'Example';
        this.onNavigated?.(url, this.title);
    }

    async resize(): Promise<void> {}
    async back(): Promise<void> {}
    async forward(): Promise<void> {}
    async reload(): Promise<void> {}
    async type(): Promise<void> {}

    async cdp<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        this.calls.push([method, params]);
        if (method === 'Page.getNavigationHistory') {
            return { currentIndex: 1, entries: [{}, {}, {}] } as T;
        }
        return {} as T;
    }

    emitFrame(): void {
        this.frameListener?.(new MessageEvent('Page.screencastFrame', { data: { data: Buffer.from([1, 2, 3]).toString('base64'), sessionId: 7 } }));
    }

    close(): void {}
}

describe('BrowserManager', () => {
    test('keeps a page alive while control clients attach and streams only with a viewer', async () => {
        const page = new FakePage();
        const hub = new LiveStreamHub();
        const manager = new BrowserManager(hub, () => page);
        const statuses: BrowserInfo[] = [];
        manager.subscribe('client-1', (event) => {
            if (event.event === 'browser.status') {
                statuses.push(event.payload);
            }
        });

        const opened = await manager.open('node-1', 'client-1', 'https://example.com', 800, 600);
        expect(opened.url).toBe('https://example.com');
        expect(opened.canGoBack).toBe(true);
        expect(page.calls.some(([method]) => method === 'Page.startScreencast')).toBe(false);

        const frames: number[] = [];
        const unsubscribe = await hub.subscribe('browser:node-1', (frame) => frames.push(frame.data.byteLength));
        page.emitFrame();
        await Promise.resolve();
        expect(frames).toEqual([3]);
        expect(page.calls.map(([method]) => method).slice(-3)).toEqual(['Page.enable', 'Page.startScreencast', 'Page.screencastFrameAck']);

        unsubscribe();
        await Bun.sleep(0);
        expect(page.calls.at(-1)?.[0]).toBe('Page.stopScreencast');
        expect(statuses.some((status) => status.title === 'Example')).toBe(true);
    });

    test('normalizes local addresses without allowing local file access', async () => {
        const page = new FakePage();
        const manager = new BrowserManager(new LiveStreamHub(), () => page);
        await manager.open('node-1', 'client-1', 'localhost:3000/demo', 800, 600);
        expect(page.url).toBe('http://localhost:3000/demo');
        await expect(manager.navigate('node-1', 'file:///tmp/private')).rejects.toThrow('Only HTTP and HTTPS');
        manager.closeAll();
    });
});
