import { z } from 'zod';
import { create } from 'zustand';
import { storedJson } from '@/state/stored-json';
import type { ConnectionState } from '@/transport/transport';

const lastSeen = storedJson('ruimte.lastSeen', z.record(z.string(), z.number()));

interface LastSeenState {
    /* When each machine last had an open link here, epoch ms. */
    byEndpoint: Record<string, number>;
    see(endpointId: string, at: number): void;
    forget(endpointId: string): void;
}

/*
 * A machine that is not connected is no longer a failure to report, since most machines are closed
 * most of the time. When it last answered is what a person can still use, so it is kept across reloads.
 */
export const useLastSeen = create<LastSeenState>((set, get) => ({
    byEndpoint: lastSeen.read() ?? {},
    see(endpointId, at) {
        const byEndpoint = { ...get().byEndpoint, [endpointId]: at };
        set({ byEndpoint });
        lastSeen.write(byEndpoint);
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...byEndpoint } = get().byEndpoint;
        set({ byEndpoint });
        lastSeen.write(byEndpoint);
    }
}));

/* What the watch reads of the pool, so a test can hand it one in memory. */
export interface LastSeenSource {
    ids(): string[];
    statusOf(endpointId: string): ConnectionState;
    subscribe(handler: () => void): () => void;
}

/*
 * Notes the moment a link opens and the moment it stops being open. Both ends, because a link that
 * was up for an hour last answered when it closed, not when it opened. `flush` is for a page on its
 * way out, which closes nothing on its own.
 */
export function watchLastSeen(
    source: LastSeenSource,
    now: () => number,
    see: (endpointId: string, at: number) => void
): { stop: () => void; flush: () => void } {
    const open = new Set<string>();
    const sync = (): void => {
        const ids = new Set(source.ids());
        for (const endpointId of [...open]) {
            if (!ids.has(endpointId) || source.statusOf(endpointId).status !== 'open') {
                open.delete(endpointId);
                see(endpointId, now());
            }
        }
        for (const endpointId of ids) {
            if (!open.has(endpointId) && source.statusOf(endpointId).status === 'open') {
                open.add(endpointId);
                see(endpointId, now());
            }
        }
    };
    sync();
    const stop = source.subscribe(sync);
    return {
        stop,
        flush: () => {
            for (const endpointId of open) {
                see(endpointId, now());
            }
        }
    };
}
