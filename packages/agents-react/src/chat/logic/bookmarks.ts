import type { ChatBookmark, ChatItem } from '@ruimte/agent-contracts';
import type { TimelineRow } from './timeline';

/* What a list calls a bookmark: its name, else the start of the message. */
export const bookmarkLabel = (bookmark: ChatBookmark): string => bookmark.name ?? bookmark.excerpt;

/* The bookmarks in the order of the thread; one whose message this client does not hold goes last. */
export const bookmarksInThreadOrder = (bookmarks: readonly ChatBookmark[], order: readonly string[]): ChatBookmark[] => {
    const places = new Map(order.map((id, index) => [id, index]));
    const place = (bookmark: ChatBookmark): number => places.get(bookmark.itemId) ?? order.length;
    return [...bookmarks].sort((left, right) => place(left) - place(right) || left.createdAt - right.createdAt);
};

/*
 * Which row each bookmark is drawn at, by row id: the message's own row, or the fold of a settled
 * turn that hides a reply before its last one. A bookmark on a message this client does not hold
 * has no row.
 */
export const bookmarkRows = (
    rows: readonly TimelineRow[],
    bookmarks: readonly ChatBookmark[],
    items: Readonly<Record<string, ChatItem>>
): Map<string, ChatBookmark> => {
    const rowIds = new Set(rows.map((row) => row.id));
    const folds = new Map<string, string>();
    for (const row of rows) {
        if (row.kind === 'turn-fold') {
            folds.set(row.turn.id, row.id);
        }
    }
    const marked = new Map<string, ChatBookmark>();
    for (const bookmark of bookmarks) {
        const turnId = items[bookmark.itemId]?.turnId ?? null;
        const rowId = rowIds.has(bookmark.itemId) ? bookmark.itemId : turnId === null ? undefined : folds.get(turnId);
        if (rowId !== undefined && !marked.has(rowId)) {
            marked.set(rowId, bookmark);
        }
    }
    return marked;
};
