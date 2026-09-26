import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ChatItem } from '@ruimte/contracts';
import { hitKey, hitRow, indexRows, placeOfHit, searchChat, type ChatHit, type ChatSearch } from '@/chat/logic/search';
import type { TimelineRow } from '@/chat/logic/timeline';
import type { FindReveal } from '@/chat/ui/find-reveal';
import { findRanges } from '@/find/dom-text';
import { clearFindHighlights, setFindHighlights } from '@/find/highlights';
import { compileFind, stepIndex } from '@/find/query';
import { useFind, type FindState } from '@/find/use-find';
import { useChatRow } from '@ruimte/agents-react/state/chats';

const NOTHING: ChatSearch = { hits: [], invalid: false };

// A fold that opens but still hides the hit would otherwise be asked again on every render.
const MAX_SEEK_STEPS = 4;
// The virtualizer settles a jump over a few frames as it measures the rows it lands among, so the match is checked again after each.
const MAX_SCROLL_TRIES = 5;

interface ChatFindOptions {
    chatId: string;
    /* What Mod+F looks for, and what the bar stands in. */
    frame: RefObject<HTMLDivElement | null>;
    /* Where the rows are drawn, which is what gets marked. */
    thread: RefObject<HTMLDivElement | null>;
    scroller: RefObject<HTMLDivElement | null>;
    enabled: boolean;
    rows: readonly TimelineRow[];
    structure: Readonly<Record<string, ChatItem>> | undefined;
    order: readonly string[] | undefined;
    /* The first row on screen, where a new search starts looking. */
    firstRowInView(): number;
    openTurn(turnId: string): void;
    openGroup(id: string): void;
    openSubagent(id: string): void;
    scrollToRow(index: number): void;
    /* The height of the composer standing over the end of the scroller. */
    coveredHeight(): number;
    stopFollowing(): void;
}

export interface ChatFind {
    find: FindState;
    total: number;
    current: number | null;
    invalid: boolean;
    step(direction: 1 | -1): void;
    reveal: FindReveal | null;
    /* The row each hit is shown at, in the order of the hits. */
    hitRows: readonly number[];
    currentRow: number | null;
}

/*
 * Find in a thread. The hits come from the data (`chat/logic/search.ts`), so a folded turn and a closed
 * tool call count; going to one opens what hides it and scrolls it into view. The marks are drawn over
 * the rows on screen, which the virtualizer swaps as the thread scrolls, so they are drawn again after
 * every change to the rows' DOM.
 */
export const useChatFind = (options: ChatFindOptions): ChatFind => {
    const { chatId, rows, structure, order } = options;
    const find = useFind(options.frame, options.enabled);
    const items = useChatRow(chatId, (row) => (find.open ? row?.items : undefined));
    const search = useMemo(() => {
        if (!find.open || items === undefined || order === undefined) {
            return NOTHING;
        }
        return searchChat(
            order.flatMap((id) => items[id] ?? []),
            find.query
        );
    }, [find.open, find.query, items, order]);
    const rowIndex = useMemo(() => indexRows(rows), [rows]);
    // In the order the thread shows them, which is not always the order the items came in.
    const ordered = useMemo(
        () =>
            search.hits
                .map((hit) => ({ hit, row: hitRow(rowIndex, structure?.[hit.itemId]) }))
                .filter((entry) => entry.row !== -1)
                .sort((left, right) => left.row - right.row),
        [search, rowIndex, structure]
    );
    const [currentKey, setCurrentKey] = useState<string | null>(null);
    const [seeking, setSeeking] = useState<{ key: string; steps: number } | null>(null);
    const currentIndex = currentKey === null ? -1 : ordered.findIndex((entry) => hitKey(entry.hit) === currentKey);
    const currentEntry = currentIndex === -1 ? null : ordered[currentIndex]!;
    const current: ChatHit | null = currentEntry?.hit ?? null;
    // Waiting for its row to be drawn, to be scrolled to where the match itself is.
    const pendingScroll = useRef<{ key: string; tries: number } | null>(null);
    const queryRef = useRef(find.query);
    const optionsRef = useRef(options);
    useLayoutEffect(() => {
        optionsRef.current = options;
    });

    /* A new query moves to the first hit from the one the bar was on, or from the top of the screen,
       so each letter typed keeps the place; a thread that only grew keeps the hit it was on. */
    useLayoutEffect(() => {
        const fresh = queryRef.current !== find.query;
        queryRef.current = find.query;
        if (ordered.length === 0) {
            // The hit to go to is picked against the rows on screen, which only an effect can read.
            // oxlint-disable-next-line react/set-state-in-effect
            setCurrentKey(null);
            return;
        }
        if (currentEntry !== null && !fresh) {
            return;
        }
        const anchor = currentEntry?.row ?? optionsRef.current.firstRowInView();
        const index = Math.max(
            0,
            ordered.findIndex((entry) => entry.row >= anchor)
        );
        const key = hitKey(ordered[index]!.hit);
        setCurrentKey(key);
        if (fresh) {
            setSeeking({ key, steps: 0 });
        }
    }, [ordered, find.query, currentEntry]);

    const step = (direction: 1 | -1): void => {
        const index = stepIndex(currentIndex === -1 ? null : currentIndex, ordered.length, direction);
        if (index === null) {
            return;
        }
        const key = hitKey(ordered[index]!.hit);
        setCurrentKey(key);
        setSeeking({ key, steps: 0 });
    };

    useLayoutEffect(() => {
        if (seeking === null) {
            return;
        }
        const entry = ordered.find((candidate) => hitKey(candidate.hit) === seeking.key);
        const item = entry === undefined ? undefined : structure?.[entry.hit.itemId];
        const place = placeOfHit(rows, rowIndex, item);
        const { openTurn, openGroup, openSubagent, scrollToRow, stopFollowing } = optionsRef.current;
        if (entry === undefined || place === null || seeking.steps >= MAX_SEEK_STEPS) {
            // Each step opens a turn, a group or a sub-agent in the virtualizer and waits for the rows that brings.
            // oxlint-disable-next-line react/set-state-in-effect
            setSeeking(null);
            return;
        }
        if (place.kind === 'turn' || place.kind === 'group') {
            if (place.kind === 'turn') {
                openTurn(place.turnId);
            } else {
                openGroup(place.id);
            }
            setSeeking({ key: seeking.key, steps: seeking.steps + 1 });
            return;
        }
        const row = rows[place.index];
        if (row?.kind === 'subagent' && !row.expanded && entry.hit.field === 'output') {
            openSubagent(row.id);
            setSeeking({ key: seeking.key, steps: seeking.steps + 1 });
            return;
        }
        setSeeking(null);
        stopFollowing();
        scrollToRow(place.index);
        pendingScroll.current = { key: seeking.key, tries: 0 };
    }, [seeking, rows, rowIndex, ordered, structure]);

    const compiled = useMemo(() => compileFind(find.query), [find.query]);
    const pattern = find.open && compiled.kind === 'pattern' ? compiled.pattern : null;
    const withHits = useMemo(() => new Set(search.hits.map((hit) => hit.itemId)), [search]);
    const paintRef = useRef<() => void>(() => undefined);

    /* True when the match already stands clear of the edges and of the composer; otherwise it is centered. */
    const bringIntoView = (range: Range): boolean => {
        const scroller = options.scroller.current;
        if (scroller === null) {
            return true;
        }
        const box = scroller.getBoundingClientRect();
        const rect = range.getBoundingClientRect();
        const bottom = box.bottom - options.coveredHeight();
        const margin = Math.min(48, (bottom - box.top) / 4);
        if (rect.top >= box.top + margin && rect.bottom <= bottom - margin) {
            return true;
        }
        options.stopFollowing();
        scroller.scrollBy({ top: rect.top - (box.top + (bottom - box.top - rect.height) / 2) });
        return false;
    };

    const frameRef = useRef(0);
    const schedulePaint = (): void => {
        if (frameRef.current === 0) {
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = 0;
                paintRef.current();
            });
        }
    };

    useLayoutEffect(() => {
        paintRef.current = () => {
            const thread = options.thread.current;
            if (thread === null || pattern === null) {
                return;
            }
            const matches: Range[] = [];
            let currentRange: Range | null = null;
            for (const field of thread.querySelectorAll<HTMLElement>('[data-find-field]')) {
                // The nearest owner, so a sub-agent's own step inside its row never counts as the row.
                const itemId = field.closest<HTMLElement>('[data-find-item]')?.dataset.findItem;
                if (itemId === undefined || !withHits.has(itemId)) {
                    continue;
                }
                const ranges = findRanges(field, pattern);
                matches.push(...ranges);
                if (current !== null && current.itemId === itemId && current.field === field.dataset.findField && ranges.length > 0) {
                    // Rendered markdown can drop a match the source has; the last one on screen is the nearest.
                    currentRange = ranges[Math.min(current.occurrence, ranges.length - 1)]!;
                }
            }
            setFindHighlights(chatId, matches, currentRange);
            const pending = pendingScroll.current;
            if (currentRange === null || pending === null || pending.key !== currentKey) {
                return;
            }
            if (bringIntoView(currentRange) || pending.tries + 1 >= MAX_SCROLL_TRIES) {
                pendingScroll.current = null;
            } else {
                pendingScroll.current = { key: pending.key, tries: pending.tries + 1 };
                schedulePaint();
            }
        };
    });

    useEffect(() => {
        const thread = options.thread.current;
        if (thread === null || pattern === null) {
            clearFindHighlights(chatId);
            return;
        }
        const observer = new MutationObserver(() => schedulePaint());
        observer.observe(thread, { subtree: true, childList: true, characterData: true });
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frameRef.current);
            frameRef.current = 0;
            clearFindHighlights(chatId);
        };
    }, [chatId, pattern, options.thread]);

    // A step moves the current mark without touching the DOM, which the observer would not see.
    useEffect(() => {
        schedulePaint();
    }, [currentKey, withHits, pattern]);

    const revealId = current?.itemId ?? null;
    const revealField = current?.field ?? null;
    // Once per hit, so a row opens again when the bar comes back to it after a person closed it.
    const reveal = useMemo<FindReveal | null>(
        () => (revealId === null || revealField === null || currentKey === null ? null : { itemId: revealId, field: revealField }),
        [revealId, revealField, currentKey]
    );
    const hitRows = useMemo(() => ordered.map((entry) => entry.row), [ordered]);

    return {
        find,
        total: ordered.length,
        current: currentIndex === -1 ? null : currentIndex,
        invalid: search.invalid,
        step,
        reveal,
        hitRows,
        currentRow: currentEntry?.row ?? null
    };
};
