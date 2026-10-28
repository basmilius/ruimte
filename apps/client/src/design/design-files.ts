import { useEffect, useState } from 'react';
import { changeReaches, pagesByChange } from '@/design/design-page';
import { listDesignFolder } from '@/design/design-read';
import { useFolderWatch } from '@/state/fs-watch';
import { useTransport } from '@/transport/context';

/*
 * The pages of a design folder the most recently changed first, read again whenever something in it
 * changes; null until the machine first answers, and none while the folder is not there yet. The
 * folder may not exist until the chat makes it, so `watched` (the project folder) is the watch that
 * sees it come.
 */
export function useDesignPages(endpointId: string, folder: string | null, watched: string | null): string[] | null {
    const transport = useTransport();
    const [pages, setPages] = useState<string[] | null>(null);
    // Apart from the pages, since a folder that is not there lists none and still has to be seen coming.
    const [found, setFound] = useState(false);
    const [version, setVersion] = useState(0);

    useFolderWatch(endpointId, watched ?? folder);

    useEffect(() => {
        if (folder === null) {
            return;
        }

        let current = true;

        void listDesignFolder(endpointId, folder).then((entries) => {
            if (current) {
                setPages(entries === null ? [] : pagesByChange(entries));
                setFound(entries !== null);
            }
        });

        return () => {
            current = false;
        };
    }, [endpointId, folder, version]);

    useEffect(
        () =>
            transport.on('fs.changed', (payload) => {
                if (folder !== null && payload.paths.some((changed) => changeReaches(changed, folder, found))) {
                    setVersion((previous) => previous + 1);
                }
            }),
        [transport, folder, found]
    );

    return folder === null ? null : pages;
}
