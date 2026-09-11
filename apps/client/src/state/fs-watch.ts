import { useEffect } from 'react';
import { endpointKey } from '@/state/keys';
import { transportFor } from '@/transport';
import type { Transport } from '@/transport/transport';

interface Held {
    endpointId: string;
    path: string;
    /* How many readers want this folder; the daemon hears about the first and the last. */
    count: number;
    ready: Promise<void>;
}

/* Whether a path sits inside another, on either kind of machine. */
export const isUnderFolder = (path: string, ancestor: string): boolean => path.startsWith(`${ancestor}/`) || path.startsWith(`${ancestor}\\`);

/*
 * The folders this client is watching, counted. The daemon keeps one watch per client and per
 * folder with no count of its own, so the files panel closing while a file node reads the same
 * folder would leave that node blind to every write after it.
 */
export class FolderWatches {
    private readonly held = new Map<string, Held>();
    private readonly linkFor: (endpointId: string) => Transport | null;

    constructor(linkFor: (endpointId: string) => Transport | null) {
        this.linkFor = linkFor;
    }

    /* `ready` resolves once the daemon is watching, which is what a first read waits for so a write
       in between is reported rather than missed. */
    watch(endpointId: string, path: string): { ready: Promise<void>; release: () => void } {
        const key = endpointKey(endpointId, path);
        const link = this.linkFor(endpointId);
        const held = this.held.get(key) ?? { endpointId, path, count: 0, ready: FolderWatches.ask(link, path) };
        held.count += 1;
        this.held.set(key, held);
        let released = false;
        return {
            ready: held.ready,
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                held.count -= 1;
                if (held.count === 0) {
                    this.held.delete(key);
                    // On the machine the watch was taken out on, never on the one that happens to be active now.
                    void link?.request('fs.unwatch', { path }).catch(() => undefined);
                    this.rewatchUnder(endpointId, path);
                }
            }
        };
    }

    /*
     * A folder a recursive watch above it already covers is one the daemon skips, so the folders
     * still held under the one that just went were never registered and have to ask again.
     */
    private rewatchUnder(endpointId: string, path: string): void {
        for (const other of this.held.values()) {
            if (other.endpointId === endpointId && isUnderFolder(other.path, path)) {
                other.ready = FolderWatches.ask(this.linkFor(endpointId), other.path);
            }
        }
    }

    private static ask(link: Transport | null, path: string): Promise<void> {
        if (!link) {
            return Promise.resolve();
        }
        return link.request('fs.watch', { path }).then(
            () => undefined,
            () => undefined
        );
    }
}

export const folderWatches = new FolderWatches(transportFor);

/* One folder watched for as long as the caller is on screen. Null asks for nothing. */
export const useFolderWatch = (endpointId: string, path: string | null): void => {
    useEffect(() => {
        if (path === null) {
            return;
        }
        const watch = folderWatches.watch(endpointId, path);
        return watch.release;
    }, [endpointId, path]);
};
