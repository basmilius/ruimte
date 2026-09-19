import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { watchPool, type WatchablePool } from './pool-watch';
import type { Transport, TransportStatus } from './transport';

class FakeLink implements Transport {
    status: TransportStatus = 'connecting';
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    setStatus(status: TransportStatus): void {
        this.status = status;
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
}

class FakePool implements WatchablePool {
    private readonly links = new Map<string, FakeLink>();
    private readonly listeners = new Set<() => void>();

    put(endpointId: string, link: FakeLink): void {
        this.links.set(endpointId, link);
        this.announce();
    }

    drop(endpointId: string): void {
        this.links.delete(endpointId);
        this.announce();
    }

    ids(): string[] {
        return [...this.links.keys()];
    }

    peek(endpointId: string): Transport | null {
        return this.links.get(endpointId) ?? null;
    }

    subscribe(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    private announce(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

describe('watchPool', () => {
    test('attaches to a link the pool already holds and ends with it', () => {
        const pool = new FakePool();
        const link = new FakeLink();
        pool.put('one', link);
        let attached = 0;
        let ended = 0;

        const stop = watchPool(() => {
            attached += 1;
            return {
                subscriptions: [
                    () => {
                        ended += 1;
                    }
                ]
            };
        }, pool);

        expect(attached).toBe(1);
        pool.drop('one');
        expect(ended).toBe(1);
        stop();
        expect(ended).toBe(1);
    });

    test('asks nothing of a link that is not open yet and asks again on every reconnect', () => {
        const pool = new FakePool();
        const link = new FakeLink();
        pool.put('one', link);
        const asks: string[] = [];

        const stop = watchPool(
            (_link, endpointId) => ({
                onOpen: () => asks.push(endpointId),
                subscriptions: []
            }),
            pool
        );

        expect(asks).toEqual([]);
        link.setStatus('open');
        expect(asks).toEqual(['one']);
        link.setStatus('closed');
        link.setStatus('open');
        expect(asks).toEqual(['one', 'one']);
        stop();
        link.setStatus('open');
        expect(asks).toEqual(['one', 'one']);
    });

    test('asks an already open link at once and attaches every link only once', () => {
        const pool = new FakePool();
        const link = new FakeLink();
        link.status = 'open';
        pool.put('one', link);
        let attached = 0;
        const asks: string[] = [];

        const stop = watchPool((_link, endpointId) => {
            attached += 1;
            return { onOpen: () => asks.push(endpointId), subscriptions: [] };
        }, pool);

        expect(asks).toEqual(['one']);
        pool.put('two', new FakeLink());
        expect(attached).toBe(2);
        expect(asks).toEqual(['one']);
        stop();
    });

    test('stopping the watch ends every link it holds', () => {
        const pool = new FakePool();
        pool.put('one', new FakeLink());
        pool.put('two', new FakeLink());
        let ended = 0;

        const stop = watchPool(
            () => ({
                subscriptions: [
                    () => {
                        ended += 1;
                    }
                ]
            }),
            pool
        );

        stop();
        expect(ended).toBe(2);
    });
});
