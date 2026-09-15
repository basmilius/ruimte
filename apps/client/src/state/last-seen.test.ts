import { describe, expect, test } from 'bun:test';
import type { ConnectionState, TransportStatus } from '../transport/transport';
import { watchLastSeen, type LastSeenSource } from './last-seen';

/* A pool in memory: which machines have a link, and in which state. */
const fakeSource = () => {
    const states = new Map<string, TransportStatus>();
    const listeners = new Set<() => void>();
    const source: LastSeenSource = {
        ids: () => [...states.keys()],
        statusOf: (endpointId): ConnectionState => ({ status: states.get(endpointId) ?? 'closed', attempts: 0, retryAt: null }),
        subscribe: (handler) => {
            listeners.add(handler);
            return () => {
                listeners.delete(handler);
            };
        }
    };
    const set = (endpointId: string, status: TransportStatus | null): void => {
        if (status === null) {
            states.delete(endpointId);
        } else {
            states.set(endpointId, status);
        }
        for (const listener of [...listeners]) {
            listener();
        }
    };
    return { source, set };
};

describe('when a machine last had a link', () => {
    test('is noted when its link opens and again when it stops being open', () => {
        const { source, set } = fakeSource();
        let now = 1_000;
        const seen: [string, number][] = [];
        watchLastSeen(
            source,
            () => now,
            (endpointId, at) => seen.push([endpointId, at])
        );

        set('daemon-a', 'connecting');
        expect(seen).toEqual([]);
        set('daemon-a', 'open');
        now = 5_000;
        set('daemon-a', null);

        expect(seen).toEqual([
            ['daemon-a', 1_000],
            ['daemon-a', 5_000]
        ]);
    });

    test('a machine that never opened is never noted, and a status change on an open link notes nothing new', () => {
        const { source, set } = fakeSource();
        const seen: string[] = [];
        watchLastSeen(
            source,
            () => 0,
            (endpointId) => seen.push(endpointId)
        );
        set('daemon-a', 'connecting');
        set('daemon-a', 'closed');
        set('daemon-b', 'open');
        set('daemon-b', 'open');
        expect(seen).toEqual(['daemon-b']);
    });

    test('a page on its way out notes every link that is still open', () => {
        const { source, set } = fakeSource();
        const seen: [string, number][] = [];
        const watch = watchLastSeen(
            source,
            () => 9,
            (endpointId, at) => seen.push([endpointId, at])
        );
        set('daemon-a', 'open');
        seen.length = 0;
        watch.flush();
        expect(seen).toEqual([['daemon-a', 9]]);
    });
});
