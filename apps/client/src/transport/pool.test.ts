import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Endpoint } from '../state/endpoints';
import { TransportPool, type PooledTransport } from './pool';
import type { SocketAddress } from './websocket-transport';
import type { ConnectionState, TransportStatus } from './transport';

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

class FakeTransport implements PooledTransport {
    url: SocketAddress;
    disposed = false;
    connection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null };
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    constructor(url: SocketAddress) {
        this.url = url;
    }

    get status(): TransportStatus {
        return this.connection.status;
    }

    setStatus(status: TransportStatus): void {
        this.connection = { ...this.connection, status };
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }

    request<T extends RequestType>(): Promise<RequestMap[T]['result']> {
        return Promise.resolve(undefined as RequestMap[T]['result']);
    }

    on<E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void): () => void {
        return () => undefined;
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    switchTo(url: SocketAddress): void {
        this.url = url;
    }

    retarget(url: SocketAddress): void {
        this.url = url;
    }

    reconnects = 0;

    reconnect(): void {
        this.reconnects += 1;
    }

    dispose(): void {
        this.disposed = true;
    }
}

const setup = (idleMs = 1) => {
    const opened: FakeTransport[] = [];
    const pool = new TransportPool({
        idleMs,
        open: (target: Endpoint) => {
            const transport = new FakeTransport(`${target.wsBaseUrl}/ws`);
            opened.push(transport);
            return transport;
        }
    });
    return { pool, opened };
};

// Fake timers leave setImmediate alone. Each step runs the timers due in that millisecond, then every promise they started.
const idle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(1);
        await new Promise((resolve) => setImmediate(resolve));
    }
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('TransportPool', () => {
    test('one socket per endpoint, and the same one on every hold', () => {
        const { pool, opened } = setup();
        pool.hold(endpoint('a'));
        const first = pool.peek('a');
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        expect(pool.peek('a')).toBe(first);
        expect(pool.peek('b')).not.toBe(first);
        expect(opened).toHaveLength(2);
        expect(pool.ids()).toEqual(['a', 'b']);
    });

    test('peeking never opens a socket', () => {
        const { pool, opened } = setup();
        expect(pool.peek('a')).toBeNull();
        expect(pool.statusOf('a').noLink).toBe(true);
        expect(opened).toHaveLength(0);
        expect(pool.ids()).toEqual([]);
    });

    test('a hold keeps the socket up and the last release closes it', async () => {
        const { pool, opened } = setup();
        const release = pool.hold(endpoint('a'));
        const second = pool.hold(endpoint('a'));
        await idle();
        expect(opened[0]?.disposed).toBe(false);

        release();
        await idle();
        expect(opened[0]?.disposed).toBe(false);

        second();
        await idle();
        expect(opened[0]?.disposed).toBe(true);
        expect(pool.peek('a')).toBeNull();
        expect(pool.ids()).toEqual([]);
    });

    test('a socket whose last hold went stays up for the grace period, and a hold after that opens a fresh one', async () => {
        const { pool, opened } = setup(1_000);
        pool.hold(endpoint('a'))();
        jest.advanceTimersByTime(999);
        expect(pool.peek('a')).not.toBeNull();
        jest.advanceTimersByTime(1);
        expect(pool.peek('a')).toBeNull();

        pool.hold(endpoint('a'));
        expect(opened).toHaveLength(2);
        expect(opened[1]?.disposed).toBe(false);
    });

    test('releasing twice does not let go of a hold someone else took', async () => {
        const { pool, opened } = setup();
        const release = pool.hold(endpoint('a'));
        release();
        release();
        pool.hold(endpoint('a'));
        await idle();
        expect(opened[0]?.disposed).toBe(false);
    });

    test('reconnecting a machine keeps its transport, so every client built on it stays', () => {
        const { pool, opened } = setup();
        pool.hold(endpoint('a'));
        const held = pool.peek('a');
        pool.reconnect('a');
        pool.reconnect('nobody');
        expect(pool.peek('a')).toBe(held);
        expect(opened).toHaveLength(1);
        expect(opened[0]?.reconnects).toBe(1);
    });

    test('the id a transport is opened with follows the entry when it is rekeyed', () => {
        let currentId: (() => string) | null = null;
        const pool = new TransportPool({
            open: (target: Endpoint, idOf: () => string) => {
                currentId = idOf;
                return new FakeTransport(`${target.wsBaseUrl}/ws`);
            }
        });
        pool.hold(endpoint('10.0.0.4:4210'));
        expect(currentId!()).toBe('10.0.0.4:4210');
        pool.rekey('10.0.0.4:4210', 'daemon-a', 'ws://10.0.0.4:4210/ws');
        expect(currentId!()).toBe('daemon-a');
    });

    test('an endpoint that moved keeps its socket', () => {
        const { pool, opened } = setup();
        pool.hold(endpoint('a'));
        pool.readdress('a', 'ws://elsewhere/ws');
        expect(opened).toHaveLength(1);
        expect(opened[0]?.url).toBe('ws://elsewhere/ws');
        expect(opened[0]?.disposed).toBe(false);
    });

    test('a row that learns its daemon id keeps the socket that just answered', () => {
        const { pool, opened } = setup();
        pool.hold(endpoint('127.0.0.1:4310'));
        const underNewId = () => Promise.resolve('ws://daemon-b/ws');
        pool.rekey('127.0.0.1:4310', 'daemon-b', underNewId);
        expect(pool.peek('daemon-b')).toBe(opened[0]!);
        expect(pool.peek('127.0.0.1:4310')).toBeNull();
        expect(opened[0]?.disposed).toBe(false);
        expect(pool.ids()).toEqual(['daemon-b']);
        // A reconnect has to look the row up under the id it moved to, not the one it left.
        expect(opened[0]?.url).toBe(underNewId);
    });

    test('dropping an endpoint closes its socket and forgets it', () => {
        const { pool, opened } = setup();
        pool.hold(endpoint('a'));
        pool.drop('a');
        expect(opened[0]?.disposed).toBe(true);
        expect(pool.peek('a')).toBeNull();
    });

    test('a hold released after its machine was forgotten and paired again leaves the new socket alone', async () => {
        const { pool, opened } = setup(1_000);
        const stale = pool.hold(endpoint('a'));
        pool.drop('a');
        pool.hold(endpoint('a'));

        stale();
        jest.advanceTimersByTime(1_000);
        await idle();

        expect(opened).toHaveLength(2);
        expect(opened[1]?.disposed).toBe(false);
        expect(pool.peek('a')).toBe(opened[1]!);
    });

    test('a rekey onto a waiting socket ends it, and its countdown and status go with it', async () => {
        const { pool, opened } = setup(1_000);
        pool.hold(endpoint('daemon-b'))();
        pool.hold(endpoint('10.0.0.4:4210'));
        const heard: TransportStatus[] = [];
        pool.subscribeStatus('daemon-b', (status) => heard.push(status));

        pool.rekey('10.0.0.4:4210', 'daemon-b', 'ws://10.0.0.4:4210/ws');
        heard.length = 0;
        opened[0]!.setStatus('closed');
        jest.advanceTimersByTime(1_000);
        await idle();

        expect(opened[0]?.disposed).toBe(true);
        expect(opened[1]?.disposed).toBe(false);
        expect(pool.peek('daemon-b')).toBe(opened[1]!);
        expect(heard).toEqual([]);
    });

    test('a machine hears only its own status, and the pool hears every one', () => {
        const { pool, opened } = setup();
        pool.hold(endpoint('a'));
        pool.hold(endpoint('b'));
        const forA: TransportStatus[] = [];
        const forB: TransportStatus[] = [];
        let changes = 0;
        pool.subscribeStatus('a', (status) => forA.push(status));
        pool.subscribeStatus('b', (status) => forB.push(status));
        pool.subscribe(() => {
            changes += 1;
        });

        opened[0]!.setStatus('open');
        opened[1]!.setStatus('closed');

        expect(forA).toEqual(['open']);
        expect(forB).toEqual(['closed']);
        expect(changes).toBe(2);
        expect(pool.statusOf('a').status).toBe('open');
        expect(pool.statusOf('unknown').status).toBe('closed');
    });

    test('the status of a machine without a socket is one and the same object', () => {
        const { pool } = setup();
        expect(pool.statusOf('a')).toBe(pool.statusOf('b'));
    });
});
