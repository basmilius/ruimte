import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, LiveFrameHeader, RequestMap, RequestType } from '@ruimte/contracts';
import { endpoint } from '../../testing/fake-link';
import type { Endpoint } from '../state/endpoints';
import { TransportError, type ConnectionState, type TransportStatus } from '../transport-api/transport';
import { ActiveTransport } from './active-transport';
import { TransportPool, type PooledTransport } from './pool';

interface Pending {
    type: RequestType;
    resolve(result: unknown): void;
    reject(error: Error): void;
}

class FakeTransport implements PooledTransport {
    connection: ConnectionState = { status: 'open', attempts: 0, retryAt: null };
    readonly pending: Pending[] = [];
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<EventType, Set<(payload: never) => void>>();
    private readonly browserFrameHandlers = new Set<(header: never, bytes: Uint8Array) => void>();

    get status(): TransportStatus {
        return this.connection.status;
    }

    setStatus(status: TransportStatus): void {
        this.connection = { ...this.connection, status };
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.eventHandlers.get(event) ?? []) {
            (handler as (value: EventMap[E]) => void)(payload);
        }
    }

    emitBrowserFrame(browserId: string): void {
        for (const handler of this.browserFrameHandlers) {
            (handler as (header: LiveFrameHeader<'browser.frame'>, bytes: Uint8Array) => void)(
                { browserId, sequence: 1, width: 1, height: 1 },
                new Uint8Array()
            );
        }
    }

    onLiveFrame(event: 'device.frame' | 'browser.frame', handler: (header: never, bytes: Uint8Array) => void): () => void {
        if (event !== 'browser.frame') {
            return () => undefined;
        }
        this.browserFrameHandlers.add(handler);
        return () => {
            this.browserFrameHandlers.delete(handler);
        };
    }

    request<T extends RequestType>(type: T): Promise<RequestMap[T]['result']> {
        return new Promise((resolve, reject) => {
            this.pending.push({ type, resolve: resolve as (result: unknown) => void, reject });
        });
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        let handlers = this.eventHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(event, handlers);
        }
        handlers.add(handler as (payload: never) => void);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    switchTo(): void {}

    retarget(): void {}

    reconnect(): void {}

    dispose(): void {}
}

function setup() {
    const sockets = new Map<string, FakeTransport>();
    const pool = new TransportPool({
        idleMs: 60_000,
        open: (target: Endpoint) => {
            const socket = new FakeTransport();
            sockets.set(target.id, socket);
            return socket;
        }
    });
    let activeId = 'a';
    const listeners = new Set<() => void>();
    const transport = new ActiveTransport({
        source: pool,
        activeId: () => activeId,
        subscribeActive: (handler) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        }
    });
    const socketOf = (id: string): FakeTransport => sockets.get(id)!;
    return {
        pool,
        transport,
        socketOf,
        activate: (id: string): void => {
            activeId = id;
            for (const handler of listeners) {
                handler();
            }
        }
    };
}

function output(sessionId: string): EventMap['session.output'] {
    return { sessionId, data: 'hi' };
}

describe('ActiveTransport', () => {
    test('a request goes to the machine that is active', async () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));

        void transport.request('server.ping', {});
        expect(socketOf('a').pending.map((entry) => entry.type)).toEqual(['server.ping']);

        activate('b');
        void transport.request('server.hello', {});
        expect(socketOf('a').pending).toHaveLength(1);
        expect(socketOf('b').pending.map((entry) => entry.type)).toEqual(['server.hello']);
    });

    test('a request waits on the socket it was made on, whatever happens after', async () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));

        const answer = transport.request('server.ping', {});
        activate('b');
        socketOf('a').pending[0]!.resolve({ time: 7 });

        expect(await answer).toEqual({ time: 7 });
    });

    test('without a socket a request says so instead of hanging', async () => {
        const { transport } = setup();
        await expect(transport.request('server.ping', {})).rejects.toMatchObject({ code: 'not-connected' });
        expect(transport.status).toBe('closed');
    });

    test('a handler registered once hears the machine that is active, and only that one', () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        const seen: string[] = [];
        transport.on('session.output', (payload) => seen.push(payload.sessionId));

        socketOf('a').emit('session.output', output('on-a'));
        activate('b');
        socketOf('a').emit('session.output', output('on-a'));
        socketOf('b').emit('session.output', output('on-b'));

        expect(seen).toEqual(['on-a', 'on-b']);
    });

    test('a live frame handler follows the active machine and unsubscribes from every socket', () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        const seen: string[] = [];
        const off = transport.onLiveFrame('browser.frame', (header) => seen.push(header.browserId));

        socketOf('a').emitBrowserFrame('on-a');
        activate('b');
        socketOf('a').emitBrowserFrame('on-a');
        socketOf('b').emitBrowserFrame('on-b');
        off();
        socketOf('b').emitBrowserFrame('on-b');

        expect(seen).toEqual(['on-a', 'on-b']);
    });

    test('a handler that unsubscribes is off every socket', () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        const seen: string[] = [];
        const off = transport.on('session.output', (payload) => seen.push(payload.sessionId));
        activate('b');
        off();

        socketOf('a').emit('session.output', output('on-a'));
        socketOf('b').emit('session.output', output('on-b'));

        expect(seen).toEqual([]);
    });

    test('the status follows the active machine, and a switch is news even between two open sockets', () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        const heard: TransportStatus[] = [];
        transport.subscribeStatus((status) => heard.push(status));

        socketOf('a').setStatus('closed');
        socketOf('a').setStatus('open');
        activate('b');

        expect(heard).toEqual(['closed', 'open', 'open']);
        expect(transport.connection).toBe(socketOf('b').connection);
    });

    test('the machine that is not active keeps its own reconnect to itself', () => {
        const { pool, transport, socketOf } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        const heard: TransportStatus[] = [];
        transport.subscribeStatus((status) => heard.push(status));

        socketOf('b').setStatus('closed');
        socketOf('b').setStatus('connecting');

        expect(heard).toEqual([]);
        expect(transport.status).toBe('open');
    });

    test('a socket that the pool opens later is picked up', () => {
        const { pool, transport, socketOf } = setup();
        expect(transport.status).toBe('closed');

        pool.hold(endpoint('a'));

        expect(transport.status).toBe('open');
        void transport.request('server.ping', {});
        expect(socketOf('a').pending).toHaveLength(1);
    });

    test('a request on a socket the pool dropped is refused', async () => {
        const { pool, transport } = setup();
        pool.hold(endpoint('a'));
        pool.drop('a');

        const failure = await transport.request('server.ping', {}).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(TransportError);
        expect(transport.status).toBe('closed');
    });

    test('a list asked while the same one is on its way rides on it, and one asked after the answer goes out', async () => {
        const { pool, transport, socketOf } = setup();
        pool.hold(endpoint('a'));

        const first = transport.request('chat.list', {});
        void transport.request('session.list', {});
        void transport.request('server.ping', {});
        void transport.request('server.ping', {});
        await Promise.resolve();
        const second = transport.request('chat.list', {});
        expect(socketOf('a').pending.map((entry) => entry.type)).toEqual(['chat.list', 'session.list', 'server.ping', 'server.ping']);

        socketOf('a').pending[0]!.resolve({ chats: [] });
        expect(await first).toEqual({ chats: [] });
        expect(await second).toEqual({ chats: [] });

        void transport.request('chat.list', {});
        expect(socketOf('a').pending.filter((entry) => entry.type === 'chat.list')).toHaveLength(2);
    });

    test('a list that failed is asked again', async () => {
        const { pool, transport, socketOf } = setup();
        pool.hold(endpoint('a'));

        const first = transport.request('session.list', {});
        socketOf('a').pending[0]!.reject(new TransportError('disconnected', 'gone'));
        await first.catch(() => undefined);
        void transport.request('session.list', {});
        expect(socketOf('a').pending.filter((entry) => entry.type === 'session.list')).toHaveLength(2);
    });

    test('two facades over one socket share the list on its way', () => {
        const { pool, transport, socketOf } = setup();
        pool.hold(endpoint('a'));
        const own = new ActiveTransport({ source: pool, activeId: () => 'a', subscribeActive: () => () => undefined });

        void transport.request('chat.list', {});
        void own.request('chat.list', {});
        expect(socketOf('a').pending).toHaveLength(1);
    });

    test('a list is never shared across sockets', () => {
        const { pool, transport, socketOf, activate } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));

        void transport.request('session.list', {});
        activate('b');
        void transport.request('session.list', {});
        expect(socketOf('a').pending).toHaveLength(1);
        expect(socketOf('b').pending).toHaveLength(1);
    });
});
