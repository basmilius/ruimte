import { describe, expect, test } from 'bun:test';
import type { ConnectionState } from './transport';
import { reconnectStale, startWakeReconnect, type WakePool } from './wake';

const fakePool = (states: Record<string, ConnectionState>): WakePool & { reconnected: string[] } => {
    const reconnected: string[] = [];
    return {
        reconnected,
        ids: () => Object.keys(states),
        statusOf: (endpointId) => states[endpointId] ?? { status: 'closed', attempts: 0, retryAt: null },
        reconnect: (endpointId) => {
            reconnected.push(endpointId);
        }
    };
};

const STATES: Record<string, ConnectionState> = {
    open: { status: 'open', attempts: 0, retryAt: null },
    trying: { status: 'connecting', attempts: 1, retryAt: null },
    waiting: { status: 'connecting', attempts: 3, retryAt: 1_000 },
    closed: { status: 'closed', attempts: 0, retryAt: null }
};

describe('waking up', () => {
    test('a machine that is closed or waiting out a backoff tries again, one that is open or trying is left alone', () => {
        const pool = fakePool(STATES);
        expect(reconnectStale(pool)).toEqual(['waiting', 'closed']);
        expect(pool.reconnected).toEqual(['waiting', 'closed']);
    });

    test('only a page that turns visible reconnects', () => {
        const pool = fakePool(STATES);
        const listeners = new Set<() => void>();
        const doc = {
            visibilityState: 'hidden' as DocumentVisibilityState,
            addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
        } as unknown as Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
        const stop = startWakeReconnect(pool, doc);
        const fire = (): void => {
            for (const listener of listeners) {
                listener();
            }
        };
        fire();
        expect(pool.reconnected).toEqual([]);
        (doc as { visibilityState: DocumentVisibilityState }).visibilityState = 'visible';
        fire();
        expect(pool.reconnected).toEqual(['waiting', 'closed']);
        stop();
        expect(listeners.size).toBe(0);
    });
});
