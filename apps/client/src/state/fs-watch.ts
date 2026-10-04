import { useEffect } from 'react';
import { HeldWatches } from '@/state/held-watches';
import { machineTransport } from '@/transport';
import type { Transport } from '@/transport/transport';

/* Whether a path sits inside another, on either kind of machine. */
export function isUnderFolder(path: string, ancestor: string): boolean {
    return path.startsWith(`${ancestor}/`) || path.startsWith(`${ancestor}\\`);
}

/*
 * The folders this client is watching, counted. The files panel closing while a file node reads the
 * same folder would otherwise leave that node blind to every write after it.
 */
export class FolderWatches extends HeldWatches {
    protected ask(link: Transport, path: string): Promise<unknown> {
        return link.request('fs.watch', { path });
    }

    protected unask(link: Transport, path: string): Promise<unknown> {
        return link.request('fs.unwatch', { path });
    }

    /*
     * A folder a recursive watch above it already covers is one the daemon skips, so the folders
     * still held under the one that just went were never registered and have to ask again.
     */
    protected released(endpointId: string, path: string): void {
        this.askAgain(endpointId, (other) => isUnderFolder(other, path));
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
