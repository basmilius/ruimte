import { useEffect } from 'react';
import { HeldWatches, type HeldWatch } from '@/state/held-watches';
import { endpointKey } from '@/state/keys';
import { machineTransport } from '@/transport';
import type { Transport } from '@/transport-api/transport';

/* Whether a path sits inside another, on either kind of machine. */
export function isUnderFolder(path: string, ancestor: string): boolean {
    return path.startsWith(`${ancestor}/`) || path.startsWith(`${ancestor}\\`);
}

/*
 * The folders this client is watching, counted. The files panel closing while a file node reads the
 * same folder would otherwise leave that node blind to every write after it.
 */
export class FolderWatches extends HeldWatches {
    private readonly prepared = new Map<string, () => void>();

    /* Starts the watch while a view loads; its first reader takes over the hold. */
    prepare(endpointId: string, path: string): () => void {
        const key = endpointKey(endpointId, path);
        const held = super.watch(endpointId, path);
        const previous = this.prepared.get(key);
        const release = (): void => {
            if (this.prepared.get(key) === release) {
                this.prepared.delete(key);
            }
            held.release();
        };
        this.prepared.set(key, release);
        previous?.();
        return release;
    }

    override watch(endpointId: string, path: string, renewed?: () => void): HeldWatch {
        const held = super.watch(endpointId, path, renewed);
        this.prepared.get(endpointKey(endpointId, path))?.();
        return held;
    }

    protected ask(link: Transport, path: string): Promise<unknown> {
        return link.request('fs.watch', { path });
    }

    protected unask(link: Transport, path: string): Promise<unknown> {
        return link.request('fs.unwatch', { path });
    }

    /* An ancestor can replace the native stream of the folders below it, so those read again past the gap. */
    protected override opened(endpointId: string, path: string): void {
        this.renew(endpointId, (other) => isUnderFolder(other, path));
    }

    protected override released(endpointId: string, path: string): void {
        this.renew(endpointId, (other) => isUnderFolder(other, path));
    }
}

export const folderWatches = new FolderWatches(machineTransport);

/* One folder watched for as long as the caller is on screen. Null asks for nothing. */
export function useFolderWatch(endpointId: string, path: string | null): void {
    useEffect(() => {
        if (path === null) {
            return;
        }
        const watch = folderWatches.watch(endpointId, path);
        return watch.release;
    }, [endpointId, path]);
}
