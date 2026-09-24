import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { registerFindHost } from '@/find/hosts';
import { EMPTY_FIND_QUERY, type FindQuery } from '@/find/query';

export interface FindState {
    open: boolean;
    query: FindQuery;
    /* Counts every time the bar is asked for, so a bar that is already open takes the keyboard again. */
    summons: number;
    setQuery(query: FindQuery): void;
    close(): void;
}

/* The query asked last anywhere, which a bar opens on, the way a browser's find remembers across tabs. */
let lastQuery: FindQuery = EMPTY_FIND_QUERY;

/*
 * One searchable surface: it registers the element it draws in, so Mod+F finds it while it has the
 * focus (`find/hosts.ts`), and it keeps what its bar asks. Closing hands the keyboard back to where it
 * was when the bar opened.
 */
export const useFind = (surface: RefObject<HTMLElement | null>, enabled = true): FindState => {
    const [open, setOpen] = useState(false);
    const [query, setQueryState] = useState<FindQuery>(EMPTY_FIND_QUERY);
    const [summons, setSummons] = useState(0);
    const openRef = useRef(false);
    const returnTo = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const element = surface.current;
        if (element === null || !enabled) {
            return;
        }
        return registerFindHost({
            element,
            open: () => {
                const active = document.activeElement;
                if (active instanceof HTMLElement && active.closest('[data-find-bar]') === null) {
                    returnTo.current = active;
                }
                if (!openRef.current) {
                    openRef.current = true;
                    setOpen(true);
                    setQueryState(lastQuery);
                }
                setSummons((count) => count + 1);
            }
        });
    }, [surface, enabled]);

    const setQuery = useCallback((next: FindQuery): void => {
        lastQuery = next;
        setQueryState(next);
    }, []);

    const close = useCallback((): void => {
        openRef.current = false;
        setOpen(false);
        const target = returnTo.current;
        returnTo.current = null;
        if (target !== null && target.isConnected) {
            target.focus({ preventScroll: true });
        }
    }, []);

    // A surface that can no longer be searched (a chat that shows a sub-agent in its place) drops its bar.
    useEffect(() => {
        if (!enabled && openRef.current) {
            openRef.current = false;
            setOpen(false);
        }
    }, [enabled]);

    return { open, query, summons, setQuery, close };
};
