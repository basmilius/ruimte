import { beforeEach, describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { endpointKey } from '@/state/keys';
import type { Transport, TransportStatus } from '@/transport/transport';
import { BrowserClient } from './browser-client';
import { initialStreamUrl, normalizeUrl, useBrowser } from './registry';

const info = (browserId: string, url = 'https://example.com') => ({
    browserId,
    url,
    title: 'Example',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    favicon: null
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Array<{ type: RequestType; payload: unknown }> = [];
    private readonly eventHandlers = new Map<EventType, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    /* Set to keep the next replies on the wire, the way a slow machine does. */
    hold = false;
    private readonly held: Array<() => void> = [];

    async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (this.hold) {
            await new Promise<void>((resolve) => this.held.push(resolve));
        }
        if (type === 'browser.open' || type === 'browser.navigate' || type === 'browser.command') {
            const target = payload as { browserId: string; url?: string };
            return info(target.browserId, target.url) as RequestMap[T]['result'];
        }
        return {} as RequestMap[T]['result'];
    }

    release(): void {
        this.hold = false;
        for (const resolve of this.held.splice(0)) {
            resolve();
        }
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const handlers = this.eventHandlers.get(event) ?? new Set();
        handlers.add(handler as (payload: unknown) => void);
        this.eventHandlers.set(event, handlers);
        return () => handlers.delete(handler as (payload: unknown) => void);
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.eventHandlers.get(event) ?? []) {
            handler(payload);
        }
    }

    setStatus(status: TransportStatus): void {
        this.status = status;
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }
}

beforeEach(() => useBrowser.setState({ byKey: {} }));

describe('BrowserClient', () => {
    test('restores the project URL when the previous remote page only reports about:blank', () => {
        expect(initialStreamUrl('https://tweakers.net', 'about:blank')).toBe('https://tweakers.net');
        expect(initialStreamUrl('https://tweakers.net', 'https://tweakers.net/nieuws')).toBe('https://tweakers.net/nieuws');
    });

    test('treats a localhost port as a host instead of a URL scheme', () => {
        expect(normalizeUrl('localhost:3000/demo')).toBe('http://localhost:3000/demo');
    });

    test('opens once for two mounts and detaches after the last one', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);

        await client.open('node-1', 'https://example.com', 800, 600);
        await client.open('node-1', 'https://example.com', 900, 700);
        expect(transport.calls.map((call) => call.type)).toEqual(['browser.open', 'browser.resize']);
        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]?.title).toBe('Example');

        await client.detach('node-1');
        expect(transport.calls.at(-1)?.type).toBe('browser.resize');
        await client.detach('node-1');
        expect(transport.calls.at(-1)?.type).toBe('browser.detach');
        client.dispose();
    });

    test('a page taken off the canvas while the socket comes back is not written back', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        const key = endpointKey('machine-1', 'node-1');
        await client.open('node-1', 'https://example.com', 800, 600);

        transport.hold = true;
        transport.setStatus('closed');
        transport.setStatus('open');
        // The node leaves the canvas while the reopen still stands on the wire.
        await client.detach('node-1');
        useBrowser.setState({ byKey: {} });
        transport.release();
        await Promise.resolve();
        await Promise.resolve();

        expect(useBrowser.getState().byKey[key]).toBeUndefined();
        client.dispose();
    });

    test('folds status events into the browser row', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        await client.open('node-1', 'https://example.com', 800, 600);
        transport.emit('browser.status', {
            ...info('node-1'),
            title: 'Changed',
            canGoBack: true
        });

        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]).toMatchObject({ title: 'Changed', canGoBack: true });

        transport.emit('browser.status', info('node-1', 'https://example.com/inside'));
        transport.setStatus('closed');
        transport.setStatus('open');
        await Promise.resolve();
        expect(transport.calls.at(-1)).toEqual({
            type: 'browser.open',
            payload: {
                browserId: 'node-1',
                url: 'https://example.com/inside',
                width: 800,
                height: 600,
                deviceScaleFactor: 1
            }
        });
        client.dispose();
    });

    test('does not turn a restored page into a reconnecting blank page', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        await client.open('node-1', 'https://tweakers.net/', 800, 600);

        transport.emit('browser.status', info('node-1', 'about:blank'));
        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]?.url).toBe('https://tweakers.net/');

        transport.setStatus('closed');
        transport.setStatus('open');
        await Promise.resolve();
        expect(transport.calls.at(-1)).toEqual({
            type: 'browser.open',
            payload: {
                browserId: 'node-1',
                url: 'https://tweakers.net/',
                width: 800,
                height: 600,
                deviceScaleFactor: 1
            }
        });
        client.dispose();
    });

    test('accepts about:blank when it was explicitly requested', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        await client.open('node-1', 'https://example.com', 800, 600);

        client.navigate('node-1', 'about:blank');
        await Promise.resolve();

        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]?.url).toBe('about:blank');
        client.dispose();
    });

    test('uses the favicon proxied by the machine and lets a later page clear it', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        await client.open('node-1', 'https://example.com', 800, 600);

        transport.emit('browser.status', {
            ...info('node-1'),
            favicon: 'data:image/png;base64,AQID'
        });
        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]?.favicon).toBe('data:image/png;base64,AQID');

        transport.emit('browser.status', info('node-1'));
        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]?.favicon).toBeNull();

        transport.emit('browser.status', {
            ...info('node-1'),
            favicon: 'data:image/png;base64,AQID'
        });
        const { favicon: _favicon, ...legacyStatus } = info('node-1');
        transport.emit('browser.status', legacyStatus);
        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]?.favicon).toBe('data:image/png;base64,AQID');
        client.dispose();
    });

    test('delivers event frames for a direct browser and keeps that mode on reconnect', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        const frames: number[][] = [];
        const stop = client.onFrame('node-1', (frame) => frames.push([...frame.data]));

        await client.open('node-1', 'https://example.com', 800, 600, 'events', 2);
        transport.emit('browser.frame', {
            browserId: 'node-1',
            sequence: 1,
            width: 800,
            height: 600,
            data: 'AQID'
        });
        expect(frames).toEqual([[1, 2, 3]]);

        transport.setStatus('closed');
        transport.setStatus('open');
        await Promise.resolve();
        expect(transport.calls.at(-1)).toEqual({
            type: 'browser.open',
            payload: {
                browserId: 'node-1',
                url: 'https://example.com',
                width: 800,
                height: 600,
                deviceScaleFactor: 2,
                stream: 'events'
            }
        });
        stop();
        client.dispose();
    });
});
