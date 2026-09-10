import type { TimelineRow } from '@/chat/logic/timeline';
import { selectionWithin } from '@/ui/selection';

/* What the right-click landed on, read once when the menu opens. */
export interface TimelineTarget {
    /* The text selected inside the thread; a selection elsewhere is none of this menu's business. */
    selection: string;
    row: TimelineRow | null;
    /* The code block under the pointer, when the click landed in one. */
    code: string | null;
    /* The file a mention chip or a changed-files row names. */
    path: string | null;
}

export const EMPTY_TARGET: TimelineTarget = { selection: '', row: null, code: null, path: null };

/* The row a click landed in is the one whose id it sits under; the rest comes from the same walk up. */
export const readTimelineTarget = (element: HTMLElement, scroller: HTMLElement | null, rows: TimelineRow[]): TimelineTarget => {
    const id = element.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
    return {
        selection: selectionWithin(scroller),
        row: rows.find((row) => row.id === id) ?? null,
        code: element.closest('pre')?.textContent ?? null,
        path: element.closest<HTMLElement>('[data-file-path]')?.dataset.filePath ?? null
    };
};
