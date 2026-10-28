import type { StoreApi } from 'zustand';
import {
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isUnknownNode,
    type DeviceReference,
    type NodeTitleSource,
    type ProjectView,
    type ProjectViewLocal,
    type SplitLayout,
    type StandaloneNode
} from '@ruimte/contracts';
import { cellAt, collapseTabHosts, focusedViewId, isTabHost, locateView, viewIdsIn, type ShownView } from '@/shell/split';
import type { CanvasState } from '@/state/canvas';
import type { DiagramState } from '@/state/diagram';
import type { DrawingState } from '@/state/drawing';
import type { DocumentState } from '@/state/document';
import type { EditorRegistry } from '@/state/editors';

/*
 * What the banner over the views says about a view an agent opened, and the one thing it can do
 * about it: go to the view nothing moved for, or step back out of the one that took the cell. Null
 * where there is nothing to offer, which is an agent pointing at the view already in front.
 */
export interface ViewNotice {
    message: string;
    action: { kind: 'go'; viewId: string } | { kind: 'back'; shown: Omit<ShownView, 'layout'> } | null;
}

/* A deleted view on its way out, with what it takes to put it back as it stood. */
export interface TrashedView {
    view: ProjectView;
    index: number;
    local: ProjectViewLocal | undefined;
    /* The grid on either side of the deletion, so an undo with nothing moved in between puts back the very same one. */
    layout: { before: SplitLayout; after: SplitLayout | null } | null;
}

/* What a view list holds of the trashed views: the list without them, and their copies as the list has them now. */
export function splitTrash(views: ProjectView[], trashed: TrashedView[]): { views: ProjectView[]; trashed: TrashedView[] } {
    if (trashed.length === 0) {
        return { views, trashed };
    }
    const byId = new Map(views.map((view) => [view.id, view]));
    return {
        views: views.filter((view) => !trashed.some((entry) => entry.view.id === view.id)),
        // A view another writer deleted meanwhile has nothing left to come back to.
        trashed: trashed.flatMap((entry) => {
            const current = byId.get(entry.view.id);
            return current === undefined ? [] : [{ ...entry, view: current }];
        })
    };
}

/* What a new standalone view needs: a chat and a terminal carry a node, a browser carries a page. */
export type StandaloneRequest =
    | { kind: 'chat' | 'terminal'; name: string; id?: string; node: StandaloneNode }
    | { kind: 'design'; name: string; id?: string; node: StandaloneNode; path: string }
    | { kind: 'browser'; name: string; id?: string; url: string; browserOwner?: string }
    | { kind: 'device'; name: string; id?: string; device: DeviceReference };

/* Null when the name and its source are already there, so a blur that keeps the name claims no edit. */
export function withRenamedNode(
    views: readonly ProjectView[],
    viewId: string,
    nodeId: string,
    title: string,
    source: NodeTitleSource | null
): ProjectView[] | null {
    const view = views.find((candidate) => candidate.id === viewId);
    if (!view || !isCanvasView(view)) {
        return null;
    }
    const node = view.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || isUnknownNode(node) || (node.title === title && (node.titleSource ?? null) === source)) {
        return null;
    }
    const renamed = { ...node, title, titleSource: source ?? undefined };
    const nodes = view.nodes.map((candidate) => (candidate.id === nodeId ? renamed : candidate));
    return views.map((candidate) => (candidate.id === viewId ? { ...view, nodes } : candidate));
}

/*
 * Handed in rather than imported, so a test with stores of its own moves its views into its own
 * editors. An editor exists for exactly the views the document puts on screen.
 */
export interface DocumentPeers {
    canvases: EditorRegistry<CanvasState>;
    drawings: EditorRegistry<DrawingState>;
    diagrams: EditorRegistry<DiagramState>;
}

/* What a view holds right now: its editor while it is on screen, the document's copy otherwise. */
export function canvasOf(viewId: string | null | undefined, peers: DocumentPeers): CanvasState | null {
    return (viewId === null || viewId === undefined ? null : peers.canvases.peek(viewId)?.getState()) ?? null;
}

/*
 * Canvas editors follow the visible views. Drawing and diagram clients own their editors and may
 * still have unsaved file state, so this function only updates their shared focus.
 */
export function openEditors(
    views: ProjectView[],
    viewLocal: Record<string, ProjectViewLocal>,
    open: string[],
    focus: string | null,
    peers: DocumentPeers
): void {
    peers.canvases.keep(open);
    for (const viewId of open) {
        if (peers.canvases.peek(viewId) !== null) {
            continue;
        }
        const view = views.find((candidate) => candidate.id === viewId);
        if (view && isCanvasView(view)) {
            peers.canvases
                .of(viewId)
                .getState()
                .loadView(view, viewLocal[viewId] ?? null);
        }
    }
    peers.canvases.focus(focus);
    peers.drawings.focus(focus);
    peers.diagrams.focus(focus);
}

/* Where a view on screen stands. A drawing and a diagram keep their camera in their own editor, a canvas in its own. */
export function localOfView(view: ProjectView | undefined, peers: DocumentPeers): ProjectViewLocal {
    if (view && isDrawingView(view)) {
        return { camera: peers.drawings.peek(view.id)?.getState().viewCamera() ?? null, focusedNodeId: null };
    }
    if (view && isDiagramView(view)) {
        return { camera: peers.diagrams.peek(view.id)?.getState().viewCamera() ?? null, focusedNodeId: null };
    }
    const canvas = canvasOf(view?.id, peers);
    if (canvas === null) {
        return { camera: null, focusedNodeId: null };
    }
    const locked = Object.values(canvas.locks).some(Boolean);
    return { camera: canvas.viewCamera(), focusedNodeId: canvas.bodyFocusId, ...(locked ? { locks: canvas.locks } : {}) };
}

/*
 * Where a node lands when it moves to another view: the middle of what that view looks at, live when
 * it stands in a cell and as it was stored otherwise.
 */
export function centerOfView(
    viewId: string,
    local: ProjectViewLocal | undefined,
    node: { w: number; h: number },
    peers: DocumentPeers
): { x: number; y: number } | null {
    const camera = canvasOf(viewId, peers)?.viewCamera() ?? local?.camera ?? null;
    if (camera === null) {
        return null;
    }
    return { x: Math.round(camera.center.x - node.w / 2), y: Math.round(camera.center.y - node.h / 2) };
}

/*
 * The layout and everything derived from which cell has the focus. Every mutation of the grid goes
 * through here, so the derived fields never drift from the layout.
 */
export function settledOn(
    views: ProjectView[],
    viewLocal: Record<string, ProjectViewLocal>,
    layout: SplitLayout | null,
    was: Pick<DocumentState, 'lastCanvasViewId' | 'lastHostViewId'>
): Pick<DocumentState, 'views' | 'viewLocal' | 'layout' | 'emptyLayout' | 'activeViewId' | 'lastCanvasViewId' | 'lastHostViewId' | 'bodyFocused'> {
    layout = collapseTabHosts(layout, views);
    const activeViewId = layout === null ? null : focusedViewId(layout);
    const active = cellViewOf({ views }, activeViewId);
    const canvas = active !== null && isCanvasView(active);
    const focused = layout === null ? null : cellAt(layout, layout.focus);
    return {
        views,
        viewLocal,
        layout,
        emptyLayout: layout === null,
        activeViewId,
        lastCanvasViewId: canvas ? activeViewId : was.lastCanvasViewId,
        lastHostViewId: focused !== null && isTabHost(focused) ? focused.viewId : was.lastHostViewId,
        /* A view of its own has no canvas to fall back to, so the keyboard starts inside its body.
           A loose view is not in the list, and is no canvas either. */
        bodyFocused: activeViewId !== null && !canvas
    };
}

/* The ids standing in cells that are not views of the project: loose views, whose content the files hold. */
export function looseIdsOf(state: Pick<DocumentState, 'views' | 'layout'>): string[] {
    return state.layout === null ? [] : viewIdsIn(state.layout).filter((id) => !state.views.some((view) => view.id === id));
}

/* A project view that can stand in a cell, or a loose view that stands in one already. */
export function canStandInCell(state: Pick<DocumentState, 'views' | 'layout'>, id: string): boolean {
    const view = cellViewOf(state, id);
    return view === null ? state.layout !== null && locateView(state.layout, id) !== null : isOpenableView(view);
}

/* Which view a banner would put on screen if its button were pressed; null for one that offers nothing. */
function noticeTarget(notice: ViewNotice | null): string | null {
    if (notice === null || notice.action === null) {
        return null;
    }
    return notice.action.kind === 'go' ? notice.action.viewId : notice.action.shown.replaced;
}

/* A banner whose button would open a view the project has not got any more is a door into nothing. */
export function keptNotice(notice: ViewNotice | null, views: ProjectView[]): ViewNotice | null {
    const target = noticeTarget(notice);
    return target === null || views.some((view) => view.id === target) ? notice : null;
}

/*
 * A manual grid move makes an undo offer stale. A navigation offer survives until the requested
 * view becomes active; neither expires on a timer because the person may still need the action.
 */
function afterMove(notice: ViewNotice | null, activeViewId: string | null): ViewNotice | null {
    if (notice === null || notice.action === null) {
        return notice;
    }
    if (notice.action.kind === 'back') {
        return null;
    }
    return notice.action.viewId === activeViewId ? null : notice;
}

/* The view of the project with this id; a loose view is none, since the document does not hold it. */
export function cellViewOf(state: Pick<DocumentState, 'views'>, id: string | null): ProjectView | null {
    return state.views.find((view) => view.id === id) ?? null;
}

/* What every slice of the document works with: the store, the editors beside it and the two ways it changes. */
export interface DocumentKit {
    set: StoreApi<DocumentState>['setState'];
    get: () => DocumentState;
    peers: DocumentPeers;
    commit(layout: SplitLayout | null): void;
    /* Commits what `move` makes of the grid, when there is one and it moved. */
    change(move: (layout: SplitLayout) => SplitLayout | null): void;
    write(views: ProjectView[] | null): void;
}

export function createDocumentKit(set: DocumentKit['set'], get: DocumentKit['get'], peers: DocumentPeers): DocumentKit {
    /*
     * The one way the grid moves. Every editor on screen writes itself back first, because the
     * cell that is about to close may be holding edits and a camera that are only in that editor;
     * then the layout moves and the editors are opened and let go of to match it.
     */
    const commit = (layout: SplitLayout | null): void => {
        const state = get();
        const views = state.exportViews();
        const viewLocal = { ...state.viewLocal, ...state.exportLocal().views };
        const settled = settledOn(views, viewLocal, layout, state);
        set({ ...settled, maximized: null, viewNotice: afterMove(state.viewNotice, settled.activeViewId) });
        openEditors(views, viewLocal, settled.layout === null ? [] : viewIdsIn(settled.layout), settled.activeViewId, peers);
    };

    const change = (move: (layout: SplitLayout) => SplitLayout | null): void => {
        const { layout } = get();
        const next = layout === null ? layout : move(layout);
        if (next !== layout) {
            commit(next);
        }
    };

    /* What the pure operations in contracts hand back: a new list, or null for a call that asked
       for what is already there, which claims no edit and so does not make the project dirty. */
    const write = (views: ProjectView[] | null): void => {
        if (views !== null) {
            set((state) => ({ views, edits: state.edits + 1, viewNotice: keptNotice(state.viewNotice, views) }));
        }
    };

    return { set, get, peers, commit, change, write };
}
