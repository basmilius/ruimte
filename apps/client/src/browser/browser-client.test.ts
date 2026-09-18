import { beforeEach, describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { endpointKey } from '@/state/keys';
import type { Transport, TransportStatus } from '@/transport/transport';
import { BrowserClient } from './browser-client';
import { normalizeUrl, useBrowser } from './registry';

const info = (browserId: string, url = 'https://example.com') => ({
    browserId,
    url,
    title: 'Example',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Array<{ type: RequestType; payload: unknown }> = [];
    private readonly eventHandlers = new Map<EventType, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (type === 'browser.open' || type === 'browser.navigate' || type === 'browser.command') {
            const target = payload as { browserId: string; url?: string };
            return info(target.browserId, target.url) as RequestMap[T]['result'];
        }
        return {} as RequestMap[T]['result'];
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

    test('folds status events into the browser row', async () => {
        const transport = new FakeTransport();
        const client = new BrowserClient('machine-1', transport);
        await client.open('node-1', 'https://example.com', 800, 600);
        transport.emit('browser.status', { ...info('node-1'), title: 'Changed', canGoBack: true });

        expect(useBrowser.getState().byKey[endpointKey('machine-1', 'node-1')]).toMatchObject({ title: 'Changed', canGoBack: true });

        transport.emit('browser.status', info('node-1', 'https://example.com/inside'));
        transport.setStatus('closed');
        transport.setStatus('open');
        await Promise.resolve();
        expect(transport.calls.at(-1)).toEqual({
            type: 'browser.open',
            payload: { browserId: 'node-1', url: 'https://example.com/inside', width: 800, height: 600 }
        });
        client.dispose();
    });
});
