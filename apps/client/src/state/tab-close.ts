import { cellAt, cellViewIds, locateView } from '@/layout/split';
import { asksOnClose } from '@/state/cell-close';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { isViewPinned, setViewPinned } from '@/state/view-pins';

/*
 * Closing the tabs of a host, whatever each one holds. A loose tab closes through its own questions (an
 * unsaved file saves first, a table with unsubmitted edits asks); a view of the project only leaves the
 * cell, its session and its row in the sidebar stay. A person who keeps one at its question stops the rest.
 */

export type TabsClosing = 'others' | 'right' | 'all';

/* The tabs `closing` takes from a host's `ids` around `id`. A pinned tab stays, since a pin that went at the first tidy-up would hold nothing. */
export function tabsToClose(ids: readonly string[], id: string, closing: TabsClosing, pinned: (id: string) => boolean): string[] {
    const index = ids.indexOf(id);
    const candidates = closing === 'all' ? ids : closing === 'right' ? (index === -1 ? [] : ids.slice(index + 1)) : ids.filter((one) => one !== id);
    return candidates.filter((one) => !pinned(one));
}

function isTabPinned(id: string): boolean {
    const loose = useFiles.getState().tabs.find((tab) => tab.key === id);
    return loose === undefined ? isViewPinned(id) : loose.pinned;
}

/* A loose tab keeps its pin in the pool, a view of the project in this client's pins. */
export function setTabPinned(id: string, pinned: boolean): void {
    if (useFiles.getState().tabs.some((tab) => tab.key === id)) {
        useFiles.getState().setPinned(id, pinned);
    } else {
        setViewPinned(id, pinned);
    }
}

/* The tabs of the host `id` stands in, in their order; nothing for a view that is no tab. */
function hostTabIds(id: string): string[] {
    const { layout } = useDocument.getState();
    const at = layout === null ? null : locateView(layout, id);
    const cell = layout === null || at === null ? null : cellAt(layout, at);
    return cell === null ? [] : cellViewIds(cell);
}

/* False when a person kept the tab at one of its questions. */
export function closeTabGuarded(id: string): Promise<boolean> {
    if (asksOnClose(id)) {
        return useFiles.getState().closeGuarded(id);
    }
    useDocument.getState().closeViewTab(id);
    return Promise.resolve(true);
}

async function closeTabsGuarded(ids: readonly string[]): Promise<boolean> {
    for (const id of ids) {
        if (!(await closeTabGuarded(id))) {
            return false;
        }
    }
    return true;
}

export function closeTabsAround(id: string, closing: TabsClosing): Promise<boolean> {
    return closeTabsGuarded(tabsToClose(hostTabIds(id), id, closing, isTabPinned));
}
