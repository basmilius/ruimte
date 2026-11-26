import { cellAt, cellViewIds, locateView } from '@/layout/split';
import { useDocument } from '@/state/document';
import { placeTab, useFiles, type Tab } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import type { WindowItem, WindowPlace } from './messages';

export interface TakenItems {
    items: WindowItem[];

    /* Loose views that stay, because their changes are only in this page. */
    held: Tab[];
}

/* The views with these ids as another window can take them. An id that is nothing here is left out. */
export function itemsOf(ids: readonly string[]): TakenItems {
    const { views } = useDocument.getState();
    const files = useFiles.getState();
    const items: WindowItem[] = [];
    const held: Tab[] = [];

    for (const id of ids) {
        if (views.some((view) => view.id === id)) {
            items.push({ kind: 'view', id });

            continue;
        }

        const tab = files.tabs.find((entry) => entry.key === id);

        if (tab === undefined) {
            continue;
        }

        if (files.keepsOpen(tab)) {
            held.push(tab);
        } else {
            items.push({ kind: 'loose', tab });
        }
    }

    return { items, held };
}

/* Every tab of the cell a view stands in, which is what the bar of a tab host drags. */
export function cellIdsOf(viewId: string): string[] {
    const { layout } = useDocument.getState();
    const at = layout === null ? null : locateView(layout, viewId);
    const cell = layout === null || at === null ? null : cellAt(layout, at);

    return cell === null ? [viewId] : cellViewIds(cell);
}

export function idOf(item: WindowItem): string {
    return item.kind === 'view' ? item.id : item.tab.key;
}

/* Another window has the views now, so they leave this grid without the questions a close asks. */
export function letGo(ids: readonly string[]): void {
    for (const id of ids) {
        if (useDocument.getState().views.some((view) => view.id === id)) {
            useDocument.getState().closeViewTab(id);
        } else {
            useFiles.getState().release(id);
            useDocument.getState().closeLoose(id);
        }
    }
}

function stands(id: string): boolean {
    const { layout } = useDocument.getState();

    return layout !== null && locateView(layout, id) !== null;
}

function placeView(id: string, place: WindowPlace | null): boolean {
    const document = useDocument.getState();

    if (document.layout === null) {
        document.showView(id);
    } else if (place === null) {
        document.showView(id, { newTab: true });
    } else if (place.zone === 'center') {
        document.dropViewAsTab(id, place.at, place.index);
    } else {
        document.dropViewAt(id, place.at, place.zone);
    }

    return stands(id);
}

function placeLoose(tab: Tab, place: WindowPlace | null): boolean {
    const files = useFiles.getState();
    const limit = useSettings.getState().filesTabLimit;
    // The same file may be open here already, and then that tab comes to the front.
    const next = files.tabs.some((entry) => entry.key === tab.key) ? { tabs: files.tabs, active: tab.key } : placeTab(files, tab);

    if (place === null || useDocument.getState().layout === null || !files.dropTab(next, limit, place.at, place.zone, place.index)) {
        useFiles.getState().show(next, limit);
    }

    return stands(tab.key);
}

/*
 * A view another window just made may arrive before the project's change does, so `run` waits until
 * the document has it. A switch to another project ends the wait.
 */
function onceThere(id: string, run: () => void): void {
    const there = (): boolean => useDocument.getState().views.some((view) => view.id === id);

    if (there()) {
        run();

        return;
    }

    const projectId = useProject.getState().current?.projectId ?? null;

    const stop = useDocument.subscribe(() => {
        if (useProject.getState().current?.projectId !== projectId) {
            stop();
        } else if (there()) {
            stop();
            run();
        }
    });
}

/* The first view lands at `place`. The ones after it join its cell as tabs, since they stood together where they came from. */
export function placeItems(items: readonly WindowItem[], place: WindowPlace | null): void {
    let next = place;

    const beside = (id: string): void => {
        const { layout } = useDocument.getState();
        const at = layout === null ? null : locateView(layout, id);

        if (at !== null) {
            next = { at, zone: 'center', index: null };
        }
    };

    for (const item of items) {
        if (item.kind === 'loose') {
            if (placeLoose(item.tab, next)) {
                beside(item.tab.key);
            }

            continue;
        }

        const at = next;

        onceThere(item.id, () => {
            if (placeView(item.id, at)) {
                beside(item.id);
            }
        });
    }
}
