import { useCallback, useEffect, useState } from 'react';
import i18next from 'i18next';
import type { FsReadResult } from '@ruimte/contracts';
import { dirnameOf } from '@/shell/panels/files-tree';
import { folderWatches } from '@/state/fs-watch';
import { useEndpointId } from '@/state/keys';
import { TransportError } from '@/transport';
import { useTransport } from '@/transport/context';

export type FileRead = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; read: FsReadResult };

/*
 * One file's contents for as long as anything draws it. A change the daemon reports under the
 * file's own folder re-reads it in place: the state stays `ready` while the new read is on its way,
 * so nothing unmounts and the scroll position lives through a save.
 */
export const useFileRead = (path: string): { state: FileRead; retry(): void } => {
    const [state, setState] = useState<FileRead>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const folder = dirnameOf(path);

    /* Every reader holds the watch itself rather than leaving it to the files panel: a file node on
       a canvas with that panel closed would otherwise never hear that the file changed. */
    useEffect(() => {
        const watch = folderWatches.watch(endpointId, folder);
        return watch.release;
    }, [endpointId, folder]);

    useEffect(() => {
        let cancelled = false;
        transport
            .request('fs.read', { path })
            .then((read) => {
                if (!cancelled) {
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
    }, [transport, path, attempt]);

    useEffect(() => {
        return transport.on('fs.changed', (payload) => {
            if (payload.paths.includes(folder)) {
                setAttempt((count) => count + 1);
            }
        });
    }, [transport, folder]);

    const retry = useCallback(() => {
        setState({ status: 'loading' });
        setAttempt((count) => count + 1);
    }, []);

    return { state, retry };
};
