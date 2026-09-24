import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FindState } from '@/find/use-find';

/* The part of a `<webview>` a find needs. */
export interface FindablePage extends HTMLElement {
    findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number;
    stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
}

/* What `found-in-page` carries; a count arrives in more than one update, the last one final. */
export interface FoundInPage {
    activeMatchOrdinal: number;
    matches: number;
}

export interface PreviewFind {
    total: number;
    current: number | null;
    step(direction: 1 | -1): void;
    /* For the page's `found-in-page` event, which the element that owns the page listens to. */
    found(result: FoundInPage): void;
    /* Asks again after the page loaded anew, which drops the marks it had. */
    refresh(): void;
}

const NOTHING = { total: 0, current: null };

const readyPages = new WeakSet<FindablePage>();

/* Electron's find throws until the guest is attached and `dom-ready` fired, which a Cmd+F right after opening beats. */
export const trackPageReady = (element: FindablePage): void => {
    element.addEventListener('dom-ready', () => readyPages.add(element), { once: true });
};

const readyPage = (page: RefObject<FindablePage | null>): FindablePage | null => {
    const element = page.current;
    return element !== null && readyPages.has(element) ? element : null;
};

/*
 * The find bar over an HTML preview in the desktop app, answered by Chromium's own find in the page.
 * That find only knows literal text and case, so the other two toggles never reach it.
 */
export const usePreviewFind = (find: FindState, page: RefObject<FindablePage | null>): PreviewFind => {
    const [state, setState] = useState<{ total: number; current: number | null }>(NOTHING);
    const wasOpen = useRef(false);
    const { text, caseSensitive } = find.query;
    // What the page was asked last, to ask again after it reloads.
    const asked = useRef<{ text: string; caseSensitive: boolean } | null>(null);

    // A page that is not ready yet is still asked: the load that makes it ready ends in `refresh`.
    useEffect(() => {
        const element = readyPage(page);
        if (!find.open) {
            if (wasOpen.current) {
                wasOpen.current = false;
                asked.current = null;
                element?.stopFindInPage('keepSelection');
                setState(NOTHING);
            }
            return;
        }
        wasOpen.current = true;
        if (text === '') {
            asked.current = null;
            element?.stopFindInPage('clearSelection');
            setState(NOTHING);
            return;
        }
        asked.current = { text, caseSensitive };
        element?.findInPage(text, { findNext: true, matchCase: caseSensitive });
    }, [page, find.open, text, caseSensitive]);

    const refresh = useCallback((): void => {
        if (asked.current !== null) {
            readyPage(page)?.findInPage(asked.current.text, { findNext: true, matchCase: asked.current.caseSensitive });
        }
    }, [page]);

    const step = (direction: 1 | -1): void => {
        if (text !== '') {
            readyPage(page)?.findInPage(text, { forward: direction === 1, findNext: false, matchCase: caseSensitive });
        }
    };

    const found = useCallback((result: FoundInPage): void => {
        setState({ total: result.matches, current: result.activeMatchOrdinal > 0 ? result.activeMatchOrdinal - 1 : null });
    }, []);

    return { total: find.open && text !== '' ? state.total : 0, current: find.open ? state.current : null, step, found, refresh };
};
