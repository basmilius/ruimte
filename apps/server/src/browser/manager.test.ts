import { describe, expect, test } from 'bun:test';
import type { BrowserFrame, BrowserInfo } from '@ruimte/contracts';
import { BrowserManager, type BrowserPage } from './manager.ts';
import { LiveStreamHub } from '../streams/live-stream.ts';

class FakePage implements BrowserPage {
    url = 'about:blank';
    locationUrl = 'about:blank';
    title = '';
    loading = false;
    staleNativeUrl = false;
    userAgent = 'Mozilla/5.0 HeadlessChrome/153.0.0.0 Safari/537.36';
    onNavigated: ((url: string, title?: string) => void) | null = null;
    onNavigationFailed: ((error: Error) => void) | null = null;
    readonly calls: Array<[string, Record<string, unknown> | undefined]> = [];
    favicon: string | null = null;
    activeOperations = 0;
    maxActiveOperations = 0;
    private frameListener: ((event: MessageEvent<{ data: string; sessionId: number }>) => void) | null = null;

    addEventListener(_type: string, listener: (event: MessageEvent<{ data: string; sessionId: number }>) => void): void {
        this.frameListener = listener;
    }

    async navigate(url: string): Promise<void> {
        await this.operation(async () => {
            this.locationUrl = url;
            if (!this.staleNativeUrl) {
                this.url = url;
            }
            this.title = 'Example';
            this.onNavigated?.(this.staleNativeUrl ? 'about:blank' : url, this.title);
        });
    }

    async resize(): Promise<void> {
        await this.operation(() => undefined);
    }
    async back(): Promise<void> {
        await this.operation(() => undefined);
    }
    async forward(): Promise<void> {
        await this.operation(() => undefined);
    }
    async reload(): Promise<void> {
        await this.operation(() => undefined);
    }
    async type(): Promise<void> {
        await this.operation(() => undefined);
    }
    async evaluate<T>(expression: string): Promise<T> {
        return this.operation(
            () => (expression === 'location.href' ? this.locationUrl : expression === 'navigator.userAgent' ? this.userAgent : this.favicon) as T
        );
    }

    async cdp<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        return this.operation(() => {
            this.calls.push([method, params]);
            if (method === 'Page.getNavigationHistory') {
                return { currentIndex: 1, entries: [{}, {}, {}] } as T;
            }
            if (method === 'Page.captureScreenshot') {
                queueMicrotask(() => this.emitFrame());
                return { data: Buffer.from([1, 2, 3]).toString('base64') } as T;
            }
            return {} as T;
        });
    }

    emitFrame(): void {
        this.frameListener?.(
            new MessageEvent('Page.screencastFrame', {
                data: {
                    data: Buffer.from([1, 2, 3]).toString('base64'),
                    sessionId: 7
                }
            })
        );
    }

    close(): void {}

    private async operation<T>(run: () => T | Promise<T>): Promise<T> {
        this.activeOperations += 1;
        this.maxActiveOperations = Math.max(this.maxActiveOperations, this.activeOperations);
        await Bun.sleep(0);
        try {
            return await run();
        } finally {
            this.activeOperations -= 1;
        }
    }
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
        expect(page.calls).toContainEqual(['Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36' }]);
        expect(page.calls.some(([method]) => method === 'Page.startScreencast')).toBe(false);

        const frames: number[] = [];
        const unsubscribe = await hub.subscribe(opened.streamId!, (frame) => frames.push(frame.data.byteLength));
        page.emitFrame();
        await Bun.sleep(10);
        expect(frames).toEqual([3]);
        expect(page.calls.map(([method]) => method).slice(-3)).toEqual(['Page.enable', 'Page.startScreencast', 'Page.screencastFrameAck']);

        unsubscribe();
        await Bun.sleep(10);
        expect(page.calls.at(-1)?.[0]).toBe('Page.stopScreencast');
        expect(statuses.some((status) => status.title === 'Example')).toBe(true);
    });

    test('captures a high-density frame after a page follows a link', async () => {
        const page = new FakePage();
        const hub = new LiveStreamHub();
        const manager = new BrowserManager(hub, () => page);
        const frames: BrowserFrame[] = [];

        const opened = await manager.open('node-1', 'client-1', 'https://example.com', 800, 600, 'http', 2);
        const unsubscribe = await hub.subscribe(opened.streamId!, (frame) => frames.push({ browserId: 'node-1', ...frame, data: '' }));
        await page.navigate('https://example.com/next');
        page.emitFrame();
        await Bun.sleep(10);

        expect(page.calls.filter(([method]) => method === 'Page.captureScreenshot')).toHaveLength(1);
        expect(frames.at(-1)).toMatchObject({ width: 1600, height: 1200 });

        unsubscribe();
        manager.closeAll();
    });

    test('normalizes local addresses without allowing local file access', async () => {
        const page = new FakePage();
        const manager = new BrowserManager(new LiveStreamHub(), () => page);
        await manager.open('node-1', 'client-1', 'localhost:3000/demo', 800, 600);
        expect(page.url).toBe('http://localhost:3000/demo');
        await expect(manager.navigate('node-1', 'client-1', 'file:///tmp/private')).rejects.toThrow('Only HTTP and HTTPS');
        manager.closeAll();
    });

    test('sends replaceable frames through the client connection when requested', async () => {
        const page = new FakePage();
        const manager = new BrowserManager(new LiveStreamHub(), () => page);
        const frames: BrowserFrame[] = [];
        manager.subscribe('client-1', (event) => {
            if (event.event === 'browser.frame') {
                frames.push(event.payload);
            }
        });

        await manager.open('node-1', 'client-1', 'https://example.com', 800, 600, 'events', 2);
        page.emitFrame();
        await Bun.sleep(10);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({ width: 1600, height: 1200 });
        expect(page.calls.filter(([method]) => method === 'Page.captureScreenshot')).toHaveLength(1);
        expect(page.calls).toContainEqual(['Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 2, mobile: false }]);

        manager.detach('node-1', 'client-1');
        await Bun.sleep(10);
        expect(page.calls.at(-1)?.[0]).toBe('Page.stopScreencast');
        manager.closeAll();
    });

    test('sends the favicon through the machine instead of exposing its page URL', async () => {
        const page = new FakePage();
        page.favicon = 'data:image/png;base64,AQID';
        const manager = new BrowserManager(new LiveStreamHub(), () => page);
        const statuses: BrowserInfo[] = [];
        manager.subscribe('client-1', (event) => {
            if (event.event === 'browser.status') {
                statuses.push(event.payload);
            }
        });

        await manager.open('node-1', 'client-1', 'http://localhost:3000', 800, 600, 'events');
        await Bun.sleep(0);

        expect(statuses.at(-1)?.favicon).toBe('data:image/png;base64,AQID');
        manager.closeAll();
    });

    test('refuses a page value that is not a bounded image data URL', async () => {
        const page = new FakePage();
        page.favicon = 'http://localhost/private.png';
        const manager = new BrowserManager(new LiveStreamHub(), () => page);
        const statuses: BrowserInfo[] = [];
        manager.subscribe('client-1', (event) => {
            if (event.event === 'browser.status') {
                statuses.push(event.payload);
            }
        });

        await manager.open('node-1', 'client-1', 'http://localhost:3000', 800, 600);
        await Bun.sleep(0);

        expect(statuses.at(-1)?.favicon).toBeNull();
        manager.closeAll();
    });

    test('restores a saved address when an existing page is still blank', async () => {
        const page = new FakePage();
        const manager = new BrowserManager(new LiveStreamHub(), () => page);

        await manager.open('node-1', 'client-1', 'about:blank', 800, 600);
        await manager.open('node-1', 'client-1', 'https://tweakers.net', 800, 600);

        expect(page.url).toBe('https://tweakers.net');
        manager.closeAll();
    });

    test('keeps navigation separate for clients looking at the same browser node', async () => {
        const pages: FakePage[] = [];
        const manager = new BrowserManager(new LiveStreamHub(), () => {
            const page = new FakePage();
            pages.push(page);
            return page;
        });

        const first = await manager.open('node-1', 'client-1', 'https://example.com/start', 800, 600);
        const second = await manager.open('node-1', 'client-2', 'https://example.com/start', 800, 600);
        await manager.navigate('node-1', 'client-1', 'https://example.com/first');

        expect(first.streamId).not.toBe(second.streamId);
        expect(pages.map((page) => page.url)).toEqual(['https://example.com/first', 'https://example.com/start']);
        manager.closeAll();
    });

    test('uses the document location when the native WebView URL remains blank', async () => {
        const page = new FakePage();
        page.staleNativeUrl = true;
        const manager = new BrowserManager(new LiveStreamHub(), () => page);

        const opened = await manager.open('node-1', 'client-1', 'https://tweakers.net/', 800, 600);

        expect(page.url).toBe('about:blank');
        expect(page.locationUrl).toBe('https://tweakers.net/');
        expect(opened.url).toBe('https://tweakers.net/');
        manager.closeAll();
    });

    test('serializes native WebView work across navigation, evaluation, resize and CDP', async () => {
        const page = new FakePage();
        const manager = new BrowserManager(new LiveStreamHub(), () => page);

        const opening = manager.open('node-1', 'client-1', 'https://example.com', 800, 600, 'events');
        await Promise.resolve();
        const resizing = manager.resize('node-1', 'client-1', 900, 700);
        await Promise.all([opening, resizing]);
        await Bun.sleep(10);

        expect(page.maxActiveOperations).toBe(1);
        manager.closeAll();
    });
});
