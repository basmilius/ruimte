import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

interface ColumnResizeOptions {
    /* What the column is wide right now, in whole pixels. */
    width: number;
    min: number;
    /* Which edge the column hangs from. A column pinned to the window's right edge grows as the
       pointer moves left (`right`); one that starts at its own left edge grows as it moves right. */
    from: 'left' | 'right';
    /* Read at drag time, so a window resize between two drags is taken into account. */
    max?(): number;
    /* Where the dragged width goes; called on every move, so the column follows the pointer. */
    onWidth(width: number): void;
}

interface ColumnResize {
    startResize(event: ReactPointerEvent<HTMLElement>): void;
}

export const clampColumnWidth = (options: Pick<ColumnResizeOptions, 'min' | 'max'>, width: number): number => {
    const max = Math.max(options.min, options.max?.() ?? Number.MAX_SAFE_INTEGER);
    return Math.max(options.min, Math.min(Math.round(width), max));
};

/*
 * One resizable column: a handle that drags the width its owner keeps. The handle takes the pointer
 * capture, so the drag survives leaving the 8 pixels it is wide, and `[data-resizing]` on the column
 * turns off any width transition for as long as it lasts.
 */
export const useColumnResize = (ref: RefObject<HTMLElement | null>, options: ColumnResizeOptions): ColumnResize => {
    const startResize = (event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        const column = ref.current;
        const rect = column?.getBoundingClientRect();
        const anchor = options.from === 'right' ? (rect?.right ?? window.innerWidth) : (rect?.left ?? 0);
        column?.setAttribute('data-resizing', 'true');
        const onMove = (move: PointerEvent): void => {
            options.onWidth(clampColumnWidth(options, options.from === 'right' ? anchor - move.clientX : move.clientX - anchor));
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.releasePointerCapture(event.pointerId);
            column?.removeAttribute('data-resizing');
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    return { startResize };
};
