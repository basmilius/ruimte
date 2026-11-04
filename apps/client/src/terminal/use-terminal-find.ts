import { compileFind } from '@adecore/editor-react/models';
import type { TerminalViewHandle } from '@adecore/terminal';
import { prefetcher } from '@adecore/ui';
import type { ISearchOptions } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { FindState } from '@/find/use-find';
import { findResultOf, searchOptionsOf, terminalFindColors, type TerminalFindResult } from './terminal-find';

// Highlighting every match costs a decoration each; past this the addon counts but stops drawing.
const HIGHLIGHT_LIMIT = 1000;

// A terminal loads the search addon when its find bar opens; prefetched, it is there by then.
prefetcher.register(() => import('@xterm/addon-search'));

/* The part of the search addon the bar uses, so a test can stand in for it. */
export interface TerminalSearch {
    findNext(term: string, options?: ISearchOptions): boolean;
    findPrevious(term: string, options?: ISearchOptions): boolean;
    clearDecorations(): void;
    onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number }) => void): { dispose(): void };
    dispose(): void;
}

export type SearchLoader = (term: Terminal) => Promise<TerminalSearch>;

async function loadSearchAddon(term: Terminal): Promise<TerminalSearch> {
    const { SearchAddon } = await import('@xterm/addon-search');
    const addon = new SearchAddon({ highlightLimit: HIGHLIGHT_LIMIT });
    term.loadAddon(addon);
    return addon;
}

export interface TerminalFind extends TerminalFindResult {
    invalid: boolean;
    disabledReason: string | null;
    step(direction: 1 | -1): void;
}

const NO_RESULT: TerminalFindResult = { total: 0, current: null, limited: false };

/*
 * Find over a terminal's scrollback with the search addon, loaded while the bar is open. A rebuild of the
 * terminal (`generation`) hands the bar a new terminal, so the addon follows it. The addon draws the
 * matches and selects the active one; the count comes from its result event.
 */
export function useTerminalFind(
    find: Pick<FindState, 'open' | 'query'>,
    viewRef: RefObject<TerminalViewHandle | null>,
    generation: number,
    load: SearchLoader = loadSearchAddon
): TerminalFind {
    const { t } = useTranslation('common');
    const [search, setSearch] = useState<TerminalSearch | null>(null);
    // Tied to the addon it came from, so a stale count never outlives the terminal it described.
    const [counted, setCounted] = useState<{ search: TerminalSearch; result: TerminalFindResult } | null>(null);
    const [failed, setFailed] = useState(false);
    const { open, query } = find;
    const compiled = useMemo(() => compileFind(query), [query]);

    useEffect(() => {
        const term = viewRef.current?.terminal;
        if (!open || !term) {
            return;
        }
        let cancelled = false;
        let loaded: TerminalSearch | null = null;
        let listener: { dispose(): void } | null = null;
        load(term).then(
            (addon) => {
                if (cancelled) {
                    addon.dispose();
                    return;
                }
                loaded = addon;
                listener = addon.onDidChangeResults((event) => setCounted({ search: addon, result: findResultOf(event, HIGHLIGHT_LIMIT) }));
                setFailed(false);
                setSearch(addon);
            },
            () => {
                if (!cancelled) {
                    setFailed(true);
                }
            }
        );
        return () => {
            cancelled = true;
            listener?.dispose();
            loaded?.clearDecorations();
            loaded?.dispose();
            setSearch(null);
        };
    }, [open, generation, viewRef, load]);

    useEffect(() => {
        if (search === null) {
            return;
        }
        if (compiled.kind !== 'pattern') {
            search.clearDecorations();
            return;
        }
        search.findNext(query.text, { ...searchOptionsOf(query, terminalFindColors(getComputedStyle(document.documentElement))), incremental: true });
    }, [search, compiled, query]);

    const step = (direction: 1 | -1): void => {
        if (search === null || compiled.kind !== 'pattern') {
            return;
        }
        const options = searchOptionsOf(query, terminalFindColors(getComputedStyle(document.documentElement)));
        if (direction === 1) {
            search.findNext(query.text, options);
        } else {
            search.findPrevious(query.text, options);
        }
    };

    const result = search !== null && counted?.search === search && compiled.kind === 'pattern' ? counted.result : NO_RESULT;
    return { ...result, invalid: open && compiled.kind === 'invalid', disabledReason: failed ? t('find.unavailable') : null, step };
}
