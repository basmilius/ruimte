import { describe, expect, test } from 'bun:test';
import { watchOpenMachines, type OpenMachineSource } from './open-machines';
import type { TransportStatus } from './transport';

/* A pool in memory: links under ids with a status, and the `endpoint.changed` listeners on each. */
const fakeSource = () => {
    const statuses = new Map<string, TransportStatus>();
    const poolListeners = new Set<() => void>();
    const changeListeners = new Map<string, Set<() => void>>();
    const source: OpenMachineSource = {
        ids: () => [...statuses.keys()],
        statusOf: (endpointId) => ({ status: statuses.get(endpointId) ?? 'closed', attempts: 0, retryAt: null }),
        subscribe: (handler) => {
            poolListeners.add(handler);
            return () => poolListeners.delete(handler);
        },
        onChanged: (endpointId, handler) => {
            if (!statuses.has(endpointId)) {
                return null;
            }
            const listeners = changeListeners.get(endpointId) ?? new Set();
            listeners.add(handler);
            changeListeners.set(endpointId, listeners);
            return () => listeners.delete(handler);
        }
    };
    const emit = (): void => {
        for (const handler of [...poolListeners]) {
            handler();
        }
    };
    return {
        source,
        set: (endpointId: string, status: TransportStatus) => {
            statuses.set(endpointId, status);
            emit();
        },
        drop: (endpointId: string) => {
            statuses.delete(endpointId);
            emit();
        },
        change: (endpointId: string) => {
            for (const handler of [...(changeListeners.get(endpointId) ?? [])]) {
                handler();
            }
        },
        listenerCount: (endpointId: string) => changeListeners.get(endpointId)?.size ?? 0
    };
};

describe('what every open machine says about itself', () => {
    test('is asked of every machine whose link is open, not only the active one', () => {
        const pool = fakeSource();
        pool.set('local', 'open');
        pool.set('studio', 'open');
        pool.set('attic', 'connecting');
        const loaded: string[] = [];
        watchOpenMachines(pool.source, (endpointId) => loaded.push(endpointId));
        expect(loaded).toEqual(['local', 'studio']);
    });

    test('is asked once per time a link opens, and again after it closed and came back', () => {
        const pool = fakeSource();
        const loaded: string[] = [];
        watchOpenMachines(pool.source, (endpointId) => loaded.push(endpointId));
        pool.set('studio', 'connecting');
        pool.set('studio', 'open');
        pool.set('attic', 'open');
        expect(loaded).toEqual(['studio', 'attic']);
        pool.set('studio', 'closed');
        pool.set('studio', 'open');
        expect(loaded).toEqual(['studio', 'attic', 'studio']);
    });

    test('is asked again when the machine says it changed', () => {
        const pool = fakeSource();
        pool.set('studio', 'open');
        const loaded: string[] = [];
        watchOpenMachines(pool.source, (endpointId) => loaded.push(endpointId));
        pool.change('studio');
        expect(loaded).toEqual(['studio', 'studio']);
    });

    test('a machine that leaves the pool stops being listened to, and so does everything when the watch stops', () => {
        const pool = fakeSource();
        pool.set('studio', 'open');
        pool.set('attic', 'open');
        const stop = watchOpenMachines(pool.source, () => undefined);
        pool.drop('studio');
        expect(pool.listenerCount('studio')).toBe(0);
        stop();
        expect(pool.listenerCount('attic')).toBe(0);
    });
});
