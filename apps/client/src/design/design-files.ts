import { useEffect, useState } from 'react';
import { useFolderWatch } from '@/controllers/fs-watch';
import { changeReaches, designScope, listingOf, pagesByChange, scopedListingAfter, type ScopedListing } from '@/design/design-page';
import { listDesignFolder } from '@/design/design-read';
import { useTransport } from '@/workspace/context';

interface DesignPages {
    /* Null until the machine first answers. */
    pages: string[] | null;
    /* Why the last read failed, with the pages of the read before it still in `pages`. */
    problem: string | null;
    retry(): void;
}

/*
 * The pages of a design folder the most recently changed first, read again whenever something in it
 * changes; none while the folder is not there yet. A read that failed keeps the pages already known and
 * says why. The folder may not exist until the chat makes it, so `watched` (the project folder) is the
 * watch that sees it come.
 */
export function useDesignPages(endpointId: string, folder: string | null, watched: string | null): DesignPages {
    const transport = useTransport();
    const [scoped, setScoped] = useState<ScopedListing | null>(null);
    const [version, setVersion] = useState(0);
    const scope = designScope(endpointId, folder ?? '');
    // The listing of another folder is none: the pages kept through a failed read are those of this folder only.
    const listing = listingOf(scoped, scope);

    useFolderWatch(endpointId, watched ?? folder);

    useEffect(() => {
        if (folder === null) {
            return;
        }

        let current = true;

        void listDesignFolder(endpointId, folder).then((read) => {
            if (current) {
                setScoped((before) => scopedListingAfter(before, scope, read));
            }
        });

        return () => {
            current = false;
        };
    }, [endpointId, folder, scope, version]);

    const found = listing !== null && listing.entries !== null;

    useEffect(
        () =>
            transport.on('fs.changed', (payload) => {
                if (folder !== null && payload.paths.some((changed) => changeReaches(changed, folder, found))) {
                    setVersion((previous) => previous + 1);
                }
            }),
        [transport, folder, found]
    );

    const retry = (): void => setVersion((previous) => previous + 1);

    if (folder === null || listing === null) {
        return { pages: null, problem: null, retry };
    }

    return { pages: listing.entries === null ? [] : pagesByChange(listing.entries), problem: listing.problem, retry };
}
