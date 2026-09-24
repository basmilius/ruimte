import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { findRanges } from '@/find/dom-text';
import { clearFindHighlights, setFindHighlights } from '@/find/highlights';
import { compileFind, stepIndex } from '@/find/query';
import type { FindState } from '@/find/use-find';

export interface DomFind {
    total: number;
    current: number | null;
    invalid: boolean;
    step(direction: 1 | -1): void;
    /* Where the matches sit along the scroller's own height, in whole pixels from its top, one per pixel. */
    marks: readonly number[];
    currentMark: number | null;
}

/* Centers a match that stands outside the scroller, and leaves one that is in view where it is. */
const bringIntoView = (scroller: HTMLElement, range: Range): void => {
    const box = scroller.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    if (rect.top >= box.top && rect.bottom <= box.bottom) {
        return;
    }
    scroller.scrollBy({ top: rect.top - (box.top + (box.height - rect.height) / 2) });
};

const markOf = (scroller: HTMLElement, range: Range): number => {
    const box = scroller.getBoundingClientRect();
    const top = range.getBoundingClientRect().top - box.top + scroller.scrollTop;
    return Math.round((top / Math.max(1, scroller.scrollHeight)) * scroller.clientHeight);
};

/*
 * Find over a rendered document, a markdown preview: what the reader sees is what is searched. The
 * matches are ranges over the document's own text nodes, so they are read again whenever it renders.
 * `content` sits directly in the element that scrolls it.
 */
export const useDomFind = (find: FindState, content: RefObject<HTMLElement | null>): DomFind => {
    const owner = useId();
    const compiled = useMemo(() => compileFind(find.query), [find.query]);
    const pattern = find.open && compiled.kind === 'pattern' ? compiled.pattern : null;
    const ranges = useRef<Range[]>([]);
    const currentRef = useRef<number | null>(null);
    const [total, setTotal] = useState(0);
    const [current, setCurrent] = useState<number | null>(null);
    const [marks, setMarks] = useState<number[]>([]);
    const [currentMark, setCurrentMark] = useState<number | null>(null);

    const show = useCallback(
        (index: number | null, scroll: boolean): void => {
            currentRef.current = index;
            setCurrent(index);
            const range = index === null ? null : (ranges.current[index] ?? null);
            setFindHighlights(owner, ranges.current, range);
            const box = content.current?.parentElement ?? null;
            setCurrentMark(range === null || box === null ? null : markOf(box, range));
            if (scroll && range !== null && box !== null) {
                bringIntoView(box, range);
            }
        },
        [owner, content]
    );

    useEffect(() => {
        const element = content.current;
        const box = element?.parentElement ?? null;
        if (element === null || box === null || pattern === null) {
            ranges.current = [];
            currentRef.current = null;
            setTotal(0);
            setCurrent(null);
            setMarks([]);
            setCurrentMark(null);
            clearFindHighlights(owner);
            return;
        }
        const measure = (): void => {
            setMarks([...new Set(ranges.current.map((range) => markOf(box, range)))]);
            const range = currentRef.current === null ? null : (ranges.current[currentRef.current] ?? null);
            setCurrentMark(range === null ? null : markOf(box, range));
        };
        /* A new query starts from the match it was on, or from the top of the screen, so each letter
           typed keeps the place; a document that rendered again keeps the number it was on. */
        const collect = (fresh: boolean): void => {
            const previous = currentRef.current === null ? null : (ranges.current[currentRef.current] ?? null);
            ranges.current = findRanges(element, pattern);
            setTotal(ranges.current.length);
            measure();
            if (ranges.current.length === 0) {
                show(null, false);
                return;
            }
            if (!fresh) {
                show(Math.min(currentRef.current ?? 0, ranges.current.length - 1), false);
                return;
            }
            const top = box.getBoundingClientRect().top;
            const from = ranges.current.findIndex((range) =>
                previous !== null ? range.compareBoundaryPoints(Range.START_TO_START, previous) >= 0 : range.getBoundingClientRect().bottom > top
            );
            show(Math.max(0, from), true);
        };
        collect(true);
        let frame = 0;
        const observer = new MutationObserver(() => {
            if (frame === 0) {
                frame = requestAnimationFrame(() => {
                    frame = 0;
                    collect(false);
                });
            }
        });
        observer.observe(element, { subtree: true, childList: true, characterData: true });
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        resize?.observe(box);
        return () => {
            observer.disconnect();
            resize?.disconnect();
            cancelAnimationFrame(frame);
            clearFindHighlights(owner);
        };
    }, [pattern, content, owner, show]);

    const step = (direction: 1 | -1): void => {
        const index = stepIndex(currentRef.current, ranges.current.length, direction);
        if (index !== null) {
            show(index, true);
        }
    };

    return { total, current, invalid: find.open && compiled.kind === 'invalid', step, marks, currentMark };
};
