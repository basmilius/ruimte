import { afterEach, describe, expect, test } from 'bun:test';
import type { ComputerAppGrants, EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { useComputer } from '@/state/computer';
import type { WatchablePool } from '@/transport/pool-watch';
import type { Transport, TransportStatus } from '@/transport/transport';
import { startComputerWatch } from './watch';

const EMPTY: ComputerAppGrants = { always: [], terminals: [], thisTime: [] };

class FakeLink implements Transport {
    status: TransportStatus = 'open';
    grants: ComputerAppGrants = EMPTY;
    private readonly handlers = new Map<string, Set<(payload: never) => void>>();

    async request<T extends RequestType>(type: T): Promise<RequestMap[T]['result']> {
        if (type === 'computer.grants') {
            return this.grants as RequestMap[T]['result'];
        }
        throw new Error(`not asked here: ${type}`);
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const handlers = this.handlers.get(event) ?? new Set();
        handlers.add(handler as (payload: never) => void);
        this.handlers.set(event, handlers);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        this.handlers.get(event)?.forEach((handler) => handler(payload as never));
    }
}

const poolOf = (links: Record<string, FakeLink>): WatchablePool => ({
    ids: () => Object.keys(links),
    peek: (endpointId) => links[endpointId] ?? null,
    subscribe: () => () => undefined
});

const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 5; turn++) {
        await Promise.resolve();
    }
};

const stops: (() => void)[] = [];
afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
});

describe('the grants of a machine', () => {
    test('are asked for once the socket is open, and follow every change the machine tells', async () => {
        const link = new FakeLink();
        link.grants = { ...EMPTY, always: [{ name: 'TextEdit', bundleId: 'com.example.textedit', at: 1 }] };
        stops.push(startComputerWatch(poolOf({ 'machine-1': link })));
        await settle();
        expect(useComputer.getState().grants['machine-1']?.always.map((entry) => entry.name)).toEqual(['TextEdit']);

        link.emit('computer.grants', EMPTY);
        expect(useComputer.getState().grants['machine-1']).toEqual(EMPTY);
    });

    test('are forgotten with the socket', async () => {
        const link = new FakeLink();
        stops.push(startComputerWatch(poolOf({ 'machine-2': link })));
        await settle();
        expect(useComputer.getState().grants['machine-2']).toEqual(EMPTY);
        stops.pop()?.();
        expect(useComputer.getState().grants['machine-2']).toBeUndefined();
    });
});
