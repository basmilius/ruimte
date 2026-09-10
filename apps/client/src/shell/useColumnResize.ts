import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

interface ColumnResizeOptions {
    storageKey: string;
    defaultWidth: number;
    min: number;
    /* Which edge the column hangs from. A column pinned to the window's right edge grows as the
       pointer moves left (`right`); one that starts at its own left edge grows as it moves right. */
    from: 'left' | 'right';
    /* Read at drag time, so a window resize between two drags is taken into account. */
    max?(): number;
    /* A drag the person did themselves, as opposed to a width the app set. */
    onManualResize?(width: number): void;
}

interface ColumnResize {
    width: number;
    /* Sets and stores a width the app chose; a drag goes through `startResize`. */
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
    const clamp = (width: number): number => {
        const max = Math.max(options.min, options.max?.() ?? Number.MAX_SAFE_INTEGER);
        return Math.max(options.min, Math.min(Math.round(width), max));
    };
    const [width, setStored] = useState(() => clamp(readWidth(options.storageKey, options.defaultWidth)));

    const setWidth = (next: number): void => {
        const clamped = clamp(next);
        persistWidth(options.storageKey, clamped);
        setStored(clamped);
    };

    const startResize = (event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        const column = ref.current;
        const rect = column?.getBoundingClientRect();
        const anchor = options.from === 'right' ? (rect?.right ?? window.innerWidth) : (rect?.left ?? 0);
        let next = width;
        column?.setAttribute('data-resizing', 'true');
        const onMove = (move: PointerEvent): void => {
            next = clamp(options.from === 'right' ? anchor - move.clientX : move.clientX - anchor);
            setStored(next);
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.releasePointerCapture(event.pointerId);
            column?.removeAttribute('data-resizing');
            persistWidth(options.storageKey, next);
            options.onManualResize?.(next);
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    return { width, setWidth, startResize };
};
