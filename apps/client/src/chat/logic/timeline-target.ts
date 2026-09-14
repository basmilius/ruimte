import type { ChatItem } from '@ruimte/contracts';
import type { TimelineRow } from '@/chat/logic/timeline';
import { selectionWithin } from '@/ui/selection';

/* What the right-click landed on, read once when the menu opens. */
export interface TimelineTarget {
    /* The text selected inside the thread; a selection elsewhere is none of this menu's business. */
    selection: string;
    row: TimelineRow | null;
    /* The code block under the pointer, when the click landed in one. */
    code: string | null;
    /* The file a mention chip, a changed-files row or a link in an answer names. */
    path: string | null;
    /* The line that file reference named, where it named one. */
    line: number | null;
}

export const EMPTY_TARGET: TimelineTarget = { selection: '', row: null, code: null, path: null, line: null };

/*
 * The rows with the text a reply or a thought holds now. Rows are derived from the structure of a
 * thread, which a delta leaves alone, so a row still carries the text it was derived with.
 */
export const withCurrentText = (rows: TimelineRow[], items: Record<string, ChatItem> | undefined): TimelineRow[] => {
    if (!items) {
        return rows;
    }
    return rows.map((row) => {
        const item = items[row.id];
        if (row.kind === 'assistant' && item?.kind === 'assistant') {
            return { ...row, item };
        }
        if (row.kind === 'thinking' && item?.kind === 'thinking') {
            return { ...row, item };
        }
        return row;
    });
};

/* The row a click landed in is the one whose id it sits under; the rest comes from the same walk up. */
export const readTimelineTarget = (element: HTMLElement, scroller: HTMLElement | null, rows: TimelineRow[]): TimelineTarget => {
    const id = element.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
    const file = element.closest<HTMLElement>('[data-file-path]');
    const line = Number(file?.dataset.fileLine);
    return {
        selection: selectionWithin(scroller),
        row: rows.find((row) => row.id === id) ?? null,
        code: element.closest('pre')?.textContent ?? null,
        path: file?.dataset.filePath ?? null,
        line: Number.isFinite(line) && line > 0 ? line : null
    };
};
