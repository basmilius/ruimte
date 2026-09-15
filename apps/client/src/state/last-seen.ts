import { create } from 'zustand';
import type { ConnectionState } from '@/transport/transport';

const LAST_SEEN_KEY = 'ruimte.lastSeen';

type LastSeenStorage = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): LastSeenStorage | null => (typeof localStorage === 'undefined' ? null : localStorage);

const readStored = (storage: LastSeenStorage | null): Record<string, number> => {
    try {
        const parsed = JSON.parse(storage?.getItem(LAST_SEEN_KEY) ?? '{}') as unknown;
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {};
    } catch {
        return {};
    }
};

interface LastSeenState {
    /* When each machine last had an open link here, epoch ms. */
    byEndpoint: Record<string, number>;
    see(endpointId: string, at: number): void;
    forget(endpointId: string): void;
}

const write = (byEndpoint: Record<string, number>): void => {
    try {
        browserStorage()?.setItem(LAST_SEEN_KEY, JSON.stringify(byEndpoint));
    } catch {
        // Storage that refuses only costs the "last connected" line after a reload.
    }
};

/*
 * A machine that is not connected is no longer a failure to report: most machines are closed most of
 * the time. When it last answered is what a person can still use, so it is kept across reloads.
 */
export const useLastSeen = create<LastSeenState>((set, get) => ({
    byEndpoint: readStored(browserStorage()),
    see(endpointId, at) {
        const byEndpoint = { ...get().byEndpoint, [endpointId]: at };
        set({ byEndpoint });
        write(byEndpoint);
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...byEndpoint } = get().byEndpoint;
        set({ byEndpoint });
        write(byEndpoint);
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
export const watchLastSeen = (
    source: LastSeenSource,
    now: () => number,
    see: (endpointId: string, at: number) => void
): { stop: () => void; flush: () => void } => {
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
};
