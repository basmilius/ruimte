import { useEffect, useState } from 'react';
import { consoleFilesOf, consolesFolderOf } from '@/database/console-file';
import { isUnderFolder, useFolderWatch } from '@/state/fs-watch';
import { useProject } from '@/state/project';
import { useConnection } from '@/transport/context';

/* The console files of the open project by connection id, read again whenever something under the private state changes. */
export function useConsoleFiles(): Record<string, string[]> {
    const folder = useProject((state) => state.current?.folder ?? null);
    const { endpointId, transport } = useConnection();
    const [files, setFiles] = useState<Record<string, string[]>>({});
    const [reads, setReads] = useState(0);
    // The private state is there once the machine opened the project; the consoles folder only once a console is.
    const watched = folder === null ? null : `${folder}/.ruimte/private`;

    useFolderWatch(endpointId, watched);

    useEffect(() => {
        if (folder === null) {
            return;
        }
        let live = true;
        // Two levels: a folder per connection, and the consoles in it. Git ignores them, so the listing hides them unless asked.
        transport.request('fs.list', { path: consolesFolderOf(folder), depth: 2, hidden: true }).then(
            (result) => {
                if (live) {
                    setFiles(consoleFilesOf(folder, result.entries));
                }
            },
            () => {
                if (live) {
                    setFiles({});
                }
            }
        );
        return () => {
            live = false;
        };
    }, [folder, transport, reads]);

    useEffect(() => {
        if (watched === null) {
            return;
        }
        return transport.on('fs.changed', (payload) => {
            if (payload.paths.some((path) => path === watched || isUnderFolder(path, watched))) {
                setReads((count) => count + 1);
            }
        });
    }, [transport, watched]);

    return files;
}
