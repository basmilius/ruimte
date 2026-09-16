import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Endpoint } from '../state/endpoints';
import { TransportPool, type PooledTransport } from './pool';
import type { ConnectionState, TransportStatus } from './transport';
import { LinkHold } from './workspace-hold';

const GRACE_MS = 30_000;

const endpoint = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: null
});

class FakeLink implements PooledTransport {
    readonly status: TransportStatus = 'connecting';
    readonly connection: ConnectionState = { status: 'connecting', attempts: 0, retryAt: null };
    disposed = false;

    request<T extends RequestType>(): Promise<RequestMap[T]['result']> {
        return Promise.resolve(undefined as RequestMap[T]['result']);
    }

    on<E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void): () => void {
        return () => undefined;
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }

    switchTo(): void {}

    retarget(): void {}

    reconnect(): void {}

    dispose(): void {
        this.disposed = true;
    }
}

const setup = () => {
    const opened: string[] = [];
    const pool = new TransportPool({
        idleMs: GRACE_MS,
        open: (target) => {
            opened.push(target.id);
            return new FakeLink();
        }
    });
    return { pool, opened, hold: new LinkHold((row) => pool.hold(row)) };
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('the hold of a workspace', () => {
    test('keeps its machine connected while wanted, and lets go after the grace period once closed', () => {
        const { pool, hold } = setup();
        hold.set(endpoint('daemon-a'));
        jest.advanceTimersByTime(GRACE_MS * 2);
        expect(pool.peek('daemon-a')).not.toBeNull();

        hold.set(null);
        jest.advanceTimersByTime(GRACE_MS - 1);
        expect(pool.peek('daemon-a')).not.toBeNull();
        jest.advanceTimersByTime(1);
        expect(pool.peek('daemon-a')).toBeNull();
    });

    test('moving to another machine opens that one and lets the one it left go', () => {
        const { pool, hold } = setup();
        hold.set(endpoint('daemon-a'));
        hold.set(endpoint('daemon-b'));
        jest.advanceTimersByTime(GRACE_MS);
        expect(pool.ids()).toEqual(['daemon-b']);
    });

    test('asking for the machine it already holds takes no second hold', () => {
        const { pool, hold } = setup();
        hold.set(endpoint('daemon-a'));
        hold.set(endpoint('daemon-a'));
        hold.set(null);
        jest.advanceTimersByTime(GRACE_MS);
        expect(pool.peek('daemon-a')).toBeNull();
    });
});
