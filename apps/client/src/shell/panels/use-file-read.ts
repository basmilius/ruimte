import { useEffect, useRef, useState } from 'react';
import i18next from 'i18next';
import type { FsReadResult, FsReadText } from '@ruimte/contracts';
import { dirnameOf } from '@/shell/panels/files-tree';
import { readLargeText } from '@/shell/panels/large-text';
import { pathAffected } from '@/state/changed-paths';
import { folderWatches } from '@/state/fs-watch';
import { useEndpointId } from '@/state/keys';
import { TransportError } from '@/transport';
import { useTransport } from '@/transport/context';

type FileRead = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; read: FsReadResult };

/*
 * One file's contents for as long as anything draws it. A change the daemon reports under the
 * file's own folder re-reads it in place: the state stays `ready` while the new read is on its way,
 * so nothing unmounts and the scroll position lives through a save. Text past `fs.read`'s cap is
 * fetched as bytes behind it.
 */
export function useFileRead(path: string): { state: FileRead; retry(): void } {
    const [state, setState] = useState<FileRead>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const folder = dirnameOf(path);
    const large = useRef<{ path: string; read: FsReadText } | null>(null);
    const watched = useRef<{ ready: Promise<void> } | null>(null);

    /* Every reader holds the watch itself rather than leaving it to the files panel: a file node on
       a canvas with that panel closed would otherwise never hear that the file changed. */
    useEffect(() => {
        const watch = folderWatches.watch(endpointId, folder, () => setAttempt((count) => count + 1));
        watched.current = watch;
        return () => {
            if (watched.current === watch) {
                watched.current = null;
            }
            watch.release();
        };
    }, [endpointId, folder]);

    useEffect(() => {
        let cancelled = false;
        const readWhenReady = async (): Promise<FsReadResult | undefined> => {
            while (!cancelled) {
                const watch = watched.current;
                if (watch === null) {
                    return undefined;
                }
                const ready = watch.ready;
                await ready;
                if (cancelled) {
                    return undefined;
                }
                // Closing an ancestor or reconnecting can replace the barrier while this read waits.
                if (watched.current === watch && watch.ready === ready) {
                    const read = await transport.request('fs.read', { path });
                    if (!cancelled && watched.current === watch && watch.ready === ready) {
                        return read;
                    }
                }
            }
            return undefined;
        };
        void readWhenReady()
            .then(async (read) => {
                if (cancelled || read === undefined) {
                    return undefined;
                }
                if (read.kind !== 'too-large') {
                    return read;
                }
                const fetched = await readLargeText(endpointId, path, read, large.current?.path === path ? large.current.read : null);
                if (fetched.kind === 'text') {
                    large.current = { path, read: fetched };
                }
                return fetched;
            })
            .then((read) => {
                if (!cancelled && read !== undefined) {
                    setState({ status: 'ready', read });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setState({ status: 'error', message: error instanceof TransportError ? error.message : i18next.t('panels:file.readFailed') });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, endpointId, path, attempt]);

    useEffect(() => {
        return transport.on('fs.changed', (payload) => {
            if (pathAffected(path, payload.changedPaths ?? payload.paths)) {
                setAttempt((count) => count + 1);
            }
        });
    }, [transport, path]);

    const retry = () => {
        setState({ status: 'loading' });
        setAttempt((count) => count + 1);
    };

    return { state, retry };
}
