import { useSyncExternalStore } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { defaultCanvases, type CanvasNode } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { viewIdsIn } from '@/shell/split';

/* The open project as the sidebar reads it, straight off the window's stores. */
export interface SidebarSource {
    views: ProjectView[];
    activeViewId: string | null;
    /* Every view the grid has on screen; a row of one of these is open, even when it is not active. */
    openViewIds: string[];
    /* The canvas that store is holding, whose nodes are fresher than the ones in the view. */
    canvasViewId: string | null;
    order: string[];
    nodes: Record<string, CanvasNode>;
}

/* Shared stand-ins: a fresh one every build would fail the identity check below and rebuild the list. */
const EMPTY_ORDER: string[] = [];
const EMPTY_NODES: Record<string, CanvasNode> = {};

/* Every field the list is drawn from. A camera that pans and a save that flips a dirty flag are not
   among them, so the sidebar does not rebuild while someone drags the canvas around. */
const same = (before: SidebarSource, next: SidebarSource): boolean =>
    before.views === next.views &&
    before.activeViewId === next.activeViewId &&
    before.openViewIds.length === next.openViewIds.length &&
    before.openViewIds.every((id, at) => id === next.openViewIds[at]) &&
    before.canvasViewId === next.canvasViewId &&
    before.nodes === next.nodes &&
    before.order.length === next.order.length &&
    before.order.every((id, at) => id === next.order[at]);

let cached: SidebarSource | null = null;

const build = (): SidebarSource => {
    const document = useDocument.getState();
    /* The rows under a view are the nodes of its own editor, so the cell that has the focus is
       the one the sidebar reads; a canvas in a cell beside it lists its nodes under its own row. */
    const canvas = document.activeViewId === null ? null : defaultCanvases.peek(document.activeViewId)?.getState();
    const next: SidebarSource = {
        views: document.views,
        activeViewId: document.activeViewId,
        openViewIds: document.layout === null ? EMPTY_ORDER : viewIdsIn(document.layout),
        canvasViewId: canvas?.viewId ?? null,
        order: canvas?.order ?? EMPTY_ORDER,
        nodes: canvas?.nodes ?? EMPTY_NODES
    };
    if (cached === null || !same(cached, next)) {
        cached = next;
    }
    return cached;
};

const subscribe = (listener: () => void): (() => void) => {
    const offDocument = useDocument.subscribe(listener);
    const offCanvases = defaultCanvases.subscribe(listener);
    return () => {
        offDocument();
        offCanvases();
    };
};

/* The open project, rebuilt only when something the list draws changed. */
export const useSidebarSource = (): SidebarSource => useSyncExternalStore(subscribe, build);
