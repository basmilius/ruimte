import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Endpoint } from '../state/endpoints';
import { ActiveTransport } from './active-transport';
import { TransportPool, type PooledTransport } from './pool';
import { TransportError, type ConnectionState, type TransportStatus } from './transport';

const endpoint = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: null,
    daemonPublicKey: null
});

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

    get status(): TransportStatus {
        return this.connection.status;
    }

    setStatus(status: TransportStatus): void {
        this.connection = { ...this.connection, status };
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }

    /* What the daemon on the other end would push. */
    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.eventHandlers.get(event) ?? []) {
            (handler as (value: EventMap[E]) => void)(payload);
        }
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

    dispose(): void {}
}

const setup = () => {
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
};

const output = (sessionId: string): EventMap['session.output'] => ({ sessionId, data: 'hi' });

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
});
