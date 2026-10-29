import { useEffect, useState } from 'react';
import type { GitStatus, GitWatchResult } from '@ruimte/contracts';
import { pathAffected } from '@/state/changed-paths';
import { HeldWatches, type HeldWatch } from '@/state/held-watches';
import { currentEndpointId, endpointKey, useEndpointId } from '@/state/keys';
import { machineTransport, transportFor } from '@/transport';
import type { Transport } from '@/transport/transport';

/* The checkouts this client is watching, counted, so the files panel letting go of what the git panel still looks at leaves neither blind. */
export class GitWatches extends HeldWatches<GitWatchResult> {
    protected ask(link: Transport, cwd: string): Promise<GitWatchResult> {
        return link.request('git.watch', { cwd, status: true });
    }

    protected unask(link: Transport, cwd: string): Promise<unknown> {
        return link.request('git.unwatch', { cwd });
    }
}

const gitWatches = new GitWatches(machineTransport);

/* A watch on a checkout of the machine on screen. `renewed` reads again once a link that came back watches it again. */
export function watchGit(cwd: string, renewed?: () => void): HeldWatch<GitWatchResult> {
    return gitWatches.watch(currentEndpointId(), cwd, renewed);
}

/*
 * The status of a checkout, kept fresh while the caller is on screen. For a panel that only reads
 * it; the git panel drives its own reads, because it also has to say why one failed and to refresh
 * after an action of its own.
 */
export function useGitStatus(cwd: string | null): GitStatus | null {
    const endpointId = useEndpointId();
    const [held, setHeld] = useState<{ key: string; status: GitStatus } | null>(null);
    const key = endpointKey(endpointId, String(cwd));

    useEffect(() => {
        if (cwd === null) {
            return;
        }
        let cancelled = false;
        const read = (): void => {
            void (transportFor(endpointId)?.request('git.status', { cwd }) ?? Promise.reject(new Error('no socket')))
                .then((status) => {
                    if (!cancelled) {
                        setHeld({ key, status });
                    }
                })
                .catch(() => undefined);
        };
        const watch = watchGit(cwd, read);
        void watch.answer.then((answer) => {
            if (answer?.status === undefined) {
                read();
            } else if (!cancelled) {
                setHeld({ key, status: answer.status });
            }
        });
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
}

function bumped(key: string) {
    return (previous: { key: string; count: number } | null): { key: string; count: number } => ({
        key,
        count: (previous?.key === key ? previous.count : 0) + 1
    });
}

/*
 * A count that goes up whenever the working tree of a checkout moved, for a surface that reads git
 * itself and only needs to know that something did. It holds the watch of its own, so a diff tab
 * keeps up with no panel open beside it.
 */
export function useGitSignal(cwd: string | null, path?: string): number {
    const endpointId = useEndpointId();
    const [held, setHeld] = useState<{ key: string; count: number } | null>(null);
    const key = endpointKey(endpointId, `${cwd}\u0000${path ?? ''}`);

    useEffect(() => {
        if (cwd === null) {
            return;
        }
        const watch = watchGit(cwd, () => setHeld(bumped(key)));
        return () => {
            watch.release();
        };
    }, [cwd, endpointId, key]);

    useEffect(() => {
        return transportFor(endpointId)?.on('git.changed', (payload) => {
            if (payload.cwd === cwd && (path === undefined || pathAffected(path, payload.changedPaths))) {
                setHeld(bumped(key));
            }
        });
    }, [cwd, endpointId, key, path]);

    // A checkout that just changed starts over, so the reader is not told it moved when it did not.
    return held?.key === key ? held.count : 0;
}
