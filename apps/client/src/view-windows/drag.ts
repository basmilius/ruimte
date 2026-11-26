import { z } from 'zod';
import type { WindowPoint } from '@/desktop/bridge';
import { locateView } from '@/layout/split';
import { useDocument } from '@/state/document';
import { isElsewhere } from '@/state/view-homes';
import { auxWindowId } from '@/state/window-target';
import type { TabDragKind } from '@/surface/tab-drags';
import { dragging } from '@/surface/view-drag';
import { fireAndForget } from '@/transport-api/transport';
import { cellIdsOf, idOf, itemsOf } from './items';
import { canMoveViews, ItemSchema, ownWindowKey, projectKey } from './messages';
import { isWholeWindow, moveToNewWindow, takeFromWindow } from './windows';

const WINDOW_DRAG_PREFIX = 'application/x-ruimte-window-views-';

/*
 * A page cannot read a payload before the drop, so the type names the project and a window of another
 * project never sees a drag it could take. In hex, since a drag lowercases its types and a key has capitals.
 */
export function windowDragType(project: string): string {
    const hex = [...new TextEncoder().encode(project)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${WINDOW_DRAG_PREFIX}${hex}`;
}

const PayloadSchema = z.object({ from: z.string().min(1), items: z.array(ItemSchema).min(1) });

/* The views of the drag that started in this window, until it ends. */
let outgoing: string[] | null = null;

/* A view another window has is that window's to drag, also when its row in this window's sidebar is what moves. */
function isOurs(viewId: string): boolean {
    const { layout } = useDocument.getState();

    return (layout !== null && locateView(layout, viewId) !== null) || !isElsewhere(viewId);
}

/* Runs at the start of every drag of a view (`provideWindowCarry`). */
export function carryToWindows(transfer: DataTransfer, viewId: string, whole: boolean): void {
    outgoing = null;

    const project = projectKey();
    const from = ownWindowKey();

    if (project === null || from === null || !canMoveViews()) {
        return;
    }

    const ids = (whole ? cellIdsOf(viewId) : [viewId]).filter(isOurs);
    const taken = itemsOf(ids);

    // One tab that has to stay keeps the whole cell it is dragged with.
    if (taken.held.length > 0 || taken.items.length === 0) {
        return;
    }

    transfer.setData(windowDragType(project), JSON.stringify({ from, items: taken.items }));
    outgoing = taken.items.map(idOf);
}

function carriesWindowDrag(transfer: Pick<DataTransfer, 'types'>): boolean {
    const project = projectKey();

    // While `dragging()` names a view the drag started here, and this window's own grid handles it.
    return project !== null && dragging() === null && transfer.types.includes(windowDragType(project));
}

export const WINDOW_VIEW_TAB_DRAG: TabDragKind = {
    id: 'window-views',
    carries: carriesWindowDrag,
    drop(transfer, at, zone, indexFor) {
        const project = projectKey();

        if (project === null) {
            return false;
        }

        let payload: z.infer<typeof PayloadSchema>;

        try {
            payload = PayloadSchema.parse(JSON.parse(transfer.getData(windowDragType(project))));
        } catch {
            return false;
        }

        const [first] = payload.items;

        if (first === undefined) {
            return false;
        }

        takeFromWindow(payload.from, payload.items, { at, zone, index: zone === 'center' ? indexFor(idOf(first)) : null });

        return true;
    }
};

/* Where in the new window the pointer ends up, so the window opens under the hand that let go. */
const GRAB: WindowPoint = { x: 80, y: 20 };

function isOutside(event: Pick<DragEvent, 'screenX' | 'screenY'>, host: Pick<Window, 'screenX' | 'screenY' | 'outerWidth' | 'outerHeight'>): boolean {
    return (
        event.screenX < host.screenX ||
        event.screenX >= host.screenX + host.outerWidth ||
        event.screenY < host.screenY ||
        event.screenY >= host.screenY + host.outerHeight
    );
}

/* A drag that ends outside this window, taken by nothing, becomes a window of its own there. A drop another window took has the effect `move`. */
export function watchDragOut(host: Window = window): () => void {
    const onEnd = (event: DragEvent): void => {
        const ids = outgoing;
        outgoing = null;

        if (ids === null || event.dataTransfer?.dropEffect !== 'none' || !isOutside(event, host)) {
            return;
        }

        // All the views of an auxiliary window in a new one is the same window somewhere else.
        if (auxWindowId() !== null && isWholeWindow(ids)) {
            return;
        }

        void fireAndForget('moveToNewWindow', moveToNewWindow(ids, { x: event.screenX - GRAB.x, y: event.screenY - GRAB.y }));
    };

    // In the capture phase, since a source may stop the event before it reaches the window.
    host.addEventListener('dragend', onEnd, true);

    return () => host.removeEventListener('dragend', onEnd, true);
}
