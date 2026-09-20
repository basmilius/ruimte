import { useEffect, useState } from 'react';
import type { GitStatus } from '@ruimte/contracts';
import { currentEndpointId, endpointKey, useEndpointId } from '@/state/keys';
import { transportFor } from '@/transport';

interface Watch {
    /* How many panels asked for this checkout; the daemon hears about the first and the last. */
    count: number;
    ready: Promise<void>;
}

/* Keyed on the endpoint as well: the same absolute path on two machines is two checkouts. */
const watches = new Map<string, Watch>();

/*
 * A git watch that more than one panel can hold. The daemon keeps a watch per client and per
 * checkout with no count of its own, so the files panel unwatching what the git panel is still
 * looking at would leave that panel blind. `ready` resolves once the daemon is watching, which is
 * what the first status read waits for so a write in between is reported instead of missed.
 */
export const watchGit = (cwd: string): { ready: Promise<void>; release: () => void } => {
    const endpointId = currentEndpointId();
    const key = endpointKey(endpointId, cwd);
    const link = transportFor(endpointId);
    const watch = watches.get(key) ?? {
        count: 0,
        ready: (link?.request('git.watch', { cwd }) ?? Promise.reject(new Error('no socket'))).then(
            () => undefined,
            () => undefined
        )
    };
    watch.count += 1;
    watches.set(key, watch);
    let released = false;
    return {
        ready: watch.ready,
        release: () => {
            if (released) {
                return;
            }
            released = true;
            watch.count -= 1;
            if (watch.count === 0) {
                watches.delete(key);
                // On the machine the watch was taken out on, never on the one that happens to be active now.
                void link?.request('git.unwatch', { cwd }).catch(() => undefined);
            }
        }
    };
};

/*
 * The status of a checkout, kept fresh while the caller is on screen. For a panel that only reads
 * it; the git panel drives its own reads, because it also has to say why one failed and to refresh
 * after an action of its own.
 */
export const useGitStatus = (cwd: string | null): GitStatus | null => {
    const endpointId = useEndpointId();
    const [held, setHeld] = useState<{ key: string; status: GitStatus } | null>(null);
    const key = endpointKey(endpointId, String(cwd));

    useEffect(() => {
        if (cwd === null) {
            return;
        }
        let cancelled = false;
        const watch = watchGit(cwd);
        void watch.ready
            .then(() => transportFor(endpointId)?.request('git.status', { cwd }) ?? Promise.reject(new Error('no socket')))
            .then((status) => {
                if (!cancelled) {
                    setHeld({ key, status });
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            watch.release();
        };
    }, [cwd, endpointId, key]);

    useEffect(() => {
        return transportFor(endpointId)?.on('git.status', (payload) => {
            if (payload.cwd === cwd) {
                setHeld({ key, status: payload.status });
            }
        });
    }, [cwd, endpointId, key]);

    // The path on the machine that left says nothing about the same path here.
    return held?.key === key ? held.status : null;
};

/*
 * A count that goes up whenever the working tree of a checkout moved, for a surface that reads git
 * itself and only needs to know that something did. It holds the watch of its own, so a diff tab
 * keeps up with no panel open beside it.
 */
export const useGitSignal = (cwd: string | null): number => {
    const endpointId = useEndpointId();
    const [held, setHeld] = useState<{ key: string; count: number } | null>(null);
    const key = endpointKey(endpointId, String(cwd));

    useEffect(() => {
        if (cwd === null) {
            return;
        }
        const watch = watchGit(cwd);
        return () => {
            watch.release();
        };
    }, [cwd, endpointId, key]);

    useEffect(() => {
        return transportFor(endpointId)?.on('git.changed', (payload) => {
            if (payload.cwd === cwd) {
                setHeld((previous) => ({ key, count: (previous?.key === key ? previous.count : 0) + 1 }));
            }
        });
    }, [cwd, endpointId, key]);

    // A checkout that just changed starts over, so the reader is not told it moved when it did not.
    return held?.key === key ? held.count : 0;
};
