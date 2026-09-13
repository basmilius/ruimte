import { useSyncExternalStore } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import type { CanvasNode } from '@/state/canvas';
import { viewIdsIn } from '@/shell/split';
import { focusedWorkspaceId, listWorkspaces, subscribeWorkspaces } from '@/transport/connections';

/* One open project as the sidebar reads it, straight off the stores of the workspace that holds it. */
export interface SidebarSource {
    id: string;
    /* The daemon it runs on, which is what a session and a chat row are keyed on. */
    endpointId: string;
    name: string;
    views: ProjectView[];
    activeViewId: string | null;
    /* Every view the grid has on screen; a row of one of these is open, even when it is not active. */
    openViewIds: string[];
    /* The canvas that store is holding, whose nodes are fresher than the ones in the view. */
    canvasViewId: string | null;
    order: string[];
    nodes: Record<string, CanvasNode>;
    focused: boolean;
}

let cached: SidebarSource[] = [];

/* Shared stand-ins: a fresh one every build would fail the identity check below and rebuild the list. */
const EMPTY_ORDER: string[] = [];
const EMPTY_NODES: Record<string, CanvasNode> = {};

/* Every field the list is drawn from. A camera that pans and a save that flips a dirty flag are not
   among them, so the sidebar does not rebuild while someone drags the canvas around. */
const same = (before: SidebarSource, next: SidebarSource): boolean =>
    before.id === next.id &&
    before.endpointId === next.endpointId &&
    before.name === next.name &&
    before.views === next.views &&
    before.activeViewId === next.activeViewId &&
    before.openViewIds.length === next.openViewIds.length &&
    before.openViewIds.every((id, at) => id === next.openViewIds[at]) &&
    before.canvasViewId === next.canvasViewId &&
    before.nodes === next.nodes &&
    before.focused === next.focused &&
    before.order.length === next.order.length &&
    before.order.every((id, at) => id === next.order[at]);

const build = (): SidebarSource[] => {
    const focused = focusedWorkspaceId();
    const next = listWorkspaces().map((workspace, at) => {
        const document = workspace.stores.document.getState();
        /* The rows under a view are the nodes of its own editor, so the cell that has the focus is
           the one the sidebar reads; a canvas in a cell beside it lists its nodes under its own row. */
        const canvas = document.activeViewId === null ? null : workspace.stores.canvases.peek(document.activeViewId)?.getState();
        const source: SidebarSource = {
            id: workspace.id,
            endpointId: workspace.connection.endpointId,
            name: workspace.stores.project.getState().current?.name ?? '',
            views: document.views,
            activeViewId: document.activeViewId,
            openViewIds: document.layout === null ? EMPTY_ORDER : viewIdsIn(document.layout),
            canvasViewId: canvas?.viewId ?? null,
            order: canvas?.order ?? EMPTY_ORDER,
            nodes: canvas?.nodes ?? EMPTY_NODES,
            focused: workspace.id === focused
        };
        const before = cached[at];
        return before && same(before, source) ? before : source;
    });
    if (next.length === cached.length && next.every((source, at) => source === cached[at])) {
        return cached;
    }
    cached = next;
    return cached;
};

/*
 * The four stores of a workspace are one subscription each, so a list that spans workspaces cannot be
 * a row of hooks: how many there are changes with the panes. This is that subscription, rewired
 * whenever a workspace opens or closes.
 */
const subscribe = (listener: () => void): (() => void) => {
    let offStores: (() => void)[] = [];
    const rewire = (): void => {
        for (const off of offStores) {
            off();
        }
        offStores = listWorkspaces().flatMap((workspace) => [
            workspace.stores.document.subscribe(listener),
            workspace.stores.canvases.subscribe(listener),
            workspace.stores.project.subscribe(listener)
        ]);
    };
    rewire();
    const offWorkspaces = subscribeWorkspaces(() => {
        rewire();
        listener();
    });
    return () => {
        offWorkspaces();
        for (const off of offStores) {
            off();
        }
    };
};

/* What this window has open, newest last, with the workspace that has the focus marked. */
export const useSidebarSources = (): SidebarSource[] => useSyncExternalStore(subscribe, build);
