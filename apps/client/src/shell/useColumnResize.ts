import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

interface ColumnResizeOptions {
    storageKey: string;
    defaultWidth: number;
    min: number;
    /* Which edge the column hangs from. A column pinned to the window's right edge grows as the
       pointer moves left (`right`); one that starts at its own left edge grows as it moves right. */
    from: 'left' | 'right';
    /* Read at drag time, so a window resize between two drags is taken into account. */
    max?(): number;
}

interface ColumnResize {
    width: number;
    /* A width the app chose, for this session only: storage is what a drag of the person's own
       writes. The same function across renders, so an effect may depend on it. */
    setWidth(width: number): void;
    startResize(event: ReactPointerEvent<HTMLElement>): void;
}

const readWidth = (key: string, fallback: number): number => {
    try {
        const raw = localStorage.getItem(key);
        const stored = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isFinite(stored) ? stored : fallback;
    } catch {
        return fallback;
    }
};

/* Whether a drag ever wrote a width here, which is what makes it the person's rather than the app's. */
export const hasStoredWidth = (key: string): boolean => {
    try {
        return localStorage.getItem(key) !== null;
    } catch {
        return false;
    }
};

const clampWidth = (options: ColumnResizeOptions, width: number): number => {
    const max = Math.max(options.min, options.max?.() ?? Number.MAX_SAFE_INTEGER);
    return Math.max(options.min, Math.min(Math.round(width), max));
};

const persistWidth = (key: string, width: number): void => {
    try {
        localStorage.setItem(key, String(width));
    } catch {
        // Storage that refuses keeps the width for this session only.
    }
};

/*
 * One resizable column: a stored width in whole pixels and a handle that drags it. The handle takes
 * the pointer capture, so the drag survives leaving the 8 pixels it is wide, and `[data-resizing]`
 * on the column turns off any width transition for as long as it lasts.
 */
export const useColumnResize = (ref: RefObject<HTMLElement | null>, options: ColumnResizeOptions): ColumnResize => {
    /* The options as the last render left them, read when a drag or a set runs; that is what lets
       `setWidth` be one function for the life of the column. */
    const latest = useRef(options);
    useLayoutEffect(() => {
        latest.current = options;
    });

    const [width, setStored] = useState(() => clampWidth(options, readWidth(options.storageKey, options.defaultWidth)));

    const setWidth = useCallback((next: number): void => {
        setStored(clampWidth(latest.current, next));
    }, []);

    const startResize = (event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        const column = ref.current;
        const rect = column?.getBoundingClientRect();
        const anchor = options.from === 'right' ? (rect?.right ?? window.innerWidth) : (rect?.left ?? 0);
        let next = width;
        column?.setAttribute('data-resizing', 'true');
        const onMove = (move: PointerEvent): void => {
            next = clampWidth(options, options.from === 'right' ? anchor - move.clientX : move.clientX - anchor);
            setStored(next);
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.releasePointerCapture(event.pointerId);
            column?.removeAttribute('data-resizing');
            persistWidth(options.storageKey, next);
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    return { width, setWidth, startResize };
};
