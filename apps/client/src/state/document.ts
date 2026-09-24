import { useContext } from 'react';
import { createStore, type StoreApi } from 'zustand';
import type { SplitLayout } from '@ruimte/contracts';
import {
    emptyCanvasView,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isSessionView,
    isUnknownNode,
    withDuplicatedView,
    withMovedView,
    withNodeAsView,
    withNodeOnView,
    withRenamedView,
    withView,
    withViewAsNode,
    withFlags,
    withViewIcon,
    withoutView,
    type NodeAccent,
    type NodeTitleSource,
    type ProjectDocument,
    type ProjectFlags,
    type ProjectIconChoice,
    type ProjectLocal,
    type ProjectView,
    type ProjectViewLocal,
    type DeviceReference,
    type StandaloneNode
} from '@ruimte/contracts';
import { FILES_VIEW_ID } from '@/shell/files-view';
import type { CanvasPatch } from '@/project/merge';
import { NODE_SIZE, defaultCanvases, nextId, type CanvasState } from '@/state/canvas';
import { defaultDiagrams, type DiagramState } from '@/state/diagram';
import { defaultDrawings, type DrawingState } from '@/state/drawing';
import type { EditorRegistry } from '@/state/editors';
import {
    canSplit,
    cellAt,
    cellCount,
    closeCell,
    closeCellsRightOf,
    closeOtherCells,
    dropView,
    evenCells,
    evenColumns,
    focusCell,
    focusDirection,
    focusedViewId,
    isSameCell,
    layoutOf,
    locateView,
    showViewIn,
    singleLayout,
    undoShowView,
    viewIdsIn,
    type CellAt,
    type ShownView,
    type SplitDirection,
    type SplitZone
} from '@/shell/split';
import { CellViewContext, storeHook } from '@/state/workspace-stores';

export interface DocumentState {
    /* In sidebar order. The active canvas view is stale here, since the canvas store is the editor of that one. */
    views: ProjectView[];
    /*
     * The view of the cell that has the focus. It is derived from the layout and kept beside it,
     * because it is what the sidebar marks, what a shortcut acts on and what everything outside the
     * grid means by "the view": one answer to a question that is asked from everywhere.
     */
    activeViewId: string | null;
    /* How the views stand beside each other on this machine. Null while no view is open at all. */
    layout: SplitLayout | null;
    /* The view filling the whole grid for a while, the layout under it untouched. Never saved, and
       any move of the grid ends it, so the grid a person gets back is the one they left. */
    maximized: string | null;
    /* The canvas that was up last, which is where a node put back on a canvas lands. */
    lastCanvasViewId: string | null;
    /* Machine state beside the document, never in the shared file: where every view stood. */
    viewLocal: Record<string, ProjectViewLocal>;
    /* Whether the keyboard is inside the body of a standalone view; Escape leaves it to the sidebar. */
    bodyFocused: boolean;
    /* What an agent's `view open` left on the banner over the views, in either setting. Null when there is
       nothing to say; one at a time, since the last thing an agent asked for is the one worth acting on. */
    viewNotice: ViewNotice | null;
    /* Counts changes to the document itself. Switching views writes the canvas back, which is not one. */
    edits: number;
    /* True for the one update that swaps in another project, so nobody reads it as edits. */
    loading: boolean;
    /* The views that live in the shared file, which is the one a team commits. Everything else is
       this person's, which is what a view is until someone shares it. */
    shared: string[];
    /* This person's flags on views and nodes, by id. Only ever in the private file, like `shared` beside the views. */
    flags: ProjectFlags;
    /*
     * Views a person deleted that can still come back, oldest first. They are gone from the list and
     * the grid but not from the file, since another client and the daemon end what a view holds the
     * moment it leaves the file. Their sessions run on until `purgeTrash`.
     */
    trashed: TrashedView[];

    load(document: ProjectDocument | null, local: ProjectLocal | null): void;
    /*
     * What another writer changed, taken in beside what this machine is editing: the merged list of
     * views, and what each canvas on screen has to take in. Not an edit, since it is already on disk,
     * and no view opens by itself: a person's grid only moves when the person moves it.
     */
    applyMerge(views: ProjectView[], canvases: Record<string, CanvasPatch>, shared: string[], flags: ProjectFlags): void;
    /* Puts a view in the shared file or takes it back out. Only a person does this; see `SharedViewIdsSchema`. */
    setShared(id: string, shared: boolean): void;
    /* Flags views and nodes in one color, or takes their flags off with null. */
    setFlags(ids: readonly string[], color: NodeAccent | null): void;
    /* The nodes a gesture holds in any canvas on screen, which a merge leaves under the person's hand. */
    heldNodeIds(): Set<string>;
    /* Puts a view in the cell that has the focus, or moves the focus to the cell it already stands in. */
    setActiveView(id: string): void;
    /* The same, for a view someone else asked for: it answers what moved, so a toast can put it back.
       Null when nothing moved, which is a view this document does not have or the one already in front. */
    showView(id: string): ShownView | null;
    /* The way back out of that toast, run against the grid as it stands when the button is pressed. */
    undoShowView(shown: Omit<ShownView, 'layout'>): void;
    /* What an agent's `view open` has to say, put in the banner over whatever was standing in it. */
    showNotice(notice: ViewNotice): void;
    /* The button on that banner, whichever of the two it is. It takes the banner off the screen as
       well, which is what a card with a button has to do: leaving it up after the press reads as a
       press that did nothing. */
    runNotice(): void;
    dismissNotice(): void;
    /* A view into a cell's zone: the four edges split, the middle takes the place of what is there. */
    dropViewAt(viewId: string, at: CellAt, zone: SplitZone): void;
    /* The files into a cell of their own, beside the one the person is in; the focus when they already stand somewhere. */
    showFiles(): void;
    /* Takes that cell off the grid again, which is what closing the last tab does. */
    hideFiles(): void;
    /* Splits the focused cell and puts a view in the new one. */
    splitFocused(direction: SplitDirection, viewId: string): void;
    /* Takes a cell off the grid; the neighbors grow into it. The last cell stays, there has to be one. */
    closeCellAt(at: CellAt): void;
    /* Every cell but this one; the views stay in the project, as with closing one. */
    closeOtherCells(at: CellAt): void;
    /* The cells in the columns right of this one. */
    closeCellsRightOf(at: CellAt): void;
    focusCellAt(at: CellAt): void;
    /* Fills the grid with the focused cell, or puts the grid back as it was. */
    toggleMaximized(): void;
    /* The focus one cell along, which is how a grid is navigated: by direction, never by number. */
    focusTowards(direction: SplitDirection): void;
    /* A splitter dragged between two columns or two cells; the shares are of the axis they share. */
    resizeColumns(at: number, before: number, after: number): void;
    resizeCells(column: number, at: number, before: number, after: number): void;
    /* A double click on a splitter: its two neighbors even out, or with `all` every column, or every cell of the column. */
    evenColumns(at: number, all: boolean): void;
    evenCells(column: number, at: number, all: boolean): void;
    setBodyFocused(focused: boolean): void;
    addCanvasView(name: string): string;
    /* A line in the sidebar with nothing behind it, to group the views around it. */
    addSeparatorView(): string;
    /* A heading over the rows under it, with nothing behind it either. */
    addSubheaderView(name: string): string;
    /* A sketch of its own. Its elements live in a file of their own, which the daemon keeps. */
    addDrawingView(name: string): string;
    addDiagramView(name: string): string;
    /* One file on disk, read and never written. The path is all it holds. */
    /* A file as a view of its own. `opens` is false for a caller that places it on the grid itself:
       opening it first would take the cell that has the focus, and the view standing there is gone
       by the time that caller says where this one really goes. */
    addFileView(name: string, path: string, opens?: boolean): string;
    /* A chat, terminal or browser without a canvas under it. The id is the session id, as for a node. */
    addStandaloneView(view: StandaloneRequest): string;
    renameView(id: string, name: string, source?: NodeTitleSource | null): void;
    /* Overrules the mark a view wears in the lists; null hands it back to its kind. */
    setViewIcon(id: string, icon: ProjectIconChoice | null): void;
    deleteView(id: string): void;
    /* Deletes a view the way `deleteView` does, but holds on to it for `restoreView`. False when there is no such view. */
    trashView(id: string): boolean;
    /* Puts a trashed view back where it stood, in the list and on the grid. False when it is no longer trashed. */
    restoreView(id: string): boolean;
    /* Lets the trashed view with this id go for good, or every one of them; the file loses it with the next save. */
    purgeTrash(id?: string): void;
    duplicateView(id: string): string | null;
    moveView(id: string, toIndex: number): void;
    /* Moves a node from the canvas it sits on to another canvas view, keeping its id and its session. */
    moveNodeToView(nodeId: string, viewId: string): void;
    /* A rename needs no editor: a canvas on no cell has the name written into the view kept here. */
    renameNodeOnView(viewId: string, nodeId: string, title: string, source?: NodeTitleSource | null): void;
    /* Changes what a standalone view carries (its folder, its page) without touching the list. */
    updateStandalone(id: string, patch: Partial<StandaloneNode> & { url?: string }): void;
    /* Lifts a node off its canvas into a view of its own, id and session included. */
    openAsView(nodeId: string): string | null;
    /* Puts a standalone view back on a canvas as a node, in the middle of what that canvas looked at. */
    putOnCanvas(viewId: string, canvasViewId: string): boolean;

    /* The views as they would be saved: the canvas on screen written back into the view it belongs to. */
    exportViews(): ProjectView[];
    /* What the project file holds: the exported views with the trashed ones still in their place. */
    fileViews(): ProjectView[];
    exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views' | 'layout'>;
}

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
const splitTrash = (views: ProjectView[], trashed: TrashedView[]): { views: ProjectView[]; trashed: TrashedView[] } => {
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
};

/* What a new standalone view needs: a chat and a terminal carry a node, a browser carries a page. */
export type StandaloneRequest =
    | { kind: 'chat' | 'terminal'; name: string; id?: string; node: StandaloneNode }
    | { kind: 'browser'; name: string; id?: string; url: string }
    | { kind: 'device'; name: string; id?: string; device: DeviceReference };

/* Null when the name and its source are already there, so a blur that keeps the name claims no edit. */
const withRenamedNode = (
    views: readonly ProjectView[],
    viewId: string,
    nodeId: string,
    title: string,
    source: NodeTitleSource | null
): ProjectView[] | null => {
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
};

/*
 * The editors of the project, handed in rather than imported, so a test with stores of its own moves
 * its views into its own editors instead of into the window's. They are registries: the document decides which views are on screen, and an editor exists for exactly those.
 */
export interface DocumentPeers {
    canvases: EditorRegistry<CanvasState>;
    drawings: EditorRegistry<DrawingState>;
    diagrams: EditorRegistry<DiagramState>;
}

/* What a view holds right now: its editor while it is on screen, the document's copy otherwise. */
const canvasOf = (viewId: string | null | undefined, peers: DocumentPeers): CanvasState | null =>
    (viewId === null || viewId === undefined ? null : peers.canvases.peek(viewId)?.getState()) ?? null;

/*
 * Canvas editors follow the visible views. Drawing and diagram clients own their editors and may
 * still have unsaved file state, so this function only updates their shared focus.
 */
const openEditors = (views: ProjectView[], viewLocal: Record<string, ProjectViewLocal>, open: string[], focus: string | null, peers: DocumentPeers): void => {
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
};

/* Where a view on screen stands. A drawing and a diagram keep their camera in their own editor, a canvas in its own. */
const localOfView = (view: ProjectView | undefined, peers: DocumentPeers): ProjectViewLocal => {
    if (view && isDrawingView(view)) {
        return { camera: peers.drawings.peek(view.id)?.getState().viewCamera() ?? null, focusedNodeId: null };
    }
    if (view && isDiagramView(view)) {
        return { camera: peers.diagrams.peek(view.id)?.getState().viewCamera() ?? null, focusedNodeId: null };
    }
    const canvas = canvasOf(view?.id, peers);
    return canvas === null ? { camera: null, focusedNodeId: null } : { camera: canvas.viewCamera(), focusedNodeId: canvas.bodyFocusId };
};

/*
 * Where a node lands when it moves to another view: the middle of what that view looks at, live when
 * it stands in a cell and as it was stored otherwise.
 */
const centerOfView = (
    viewId: string,
    local: ProjectViewLocal | undefined,
    node: { w: number; h: number },
    peers: DocumentPeers
): { x: number; y: number } | null => {
    const camera = canvasOf(viewId, peers)?.viewCamera() ?? local?.camera ?? null;
    if (camera === null) {
        return null;
    }
    return { x: Math.round(camera.center.x - node.w / 2), y: Math.round(camera.center.y - node.h / 2) };
};

/*
 * What the document holds beside its views once the grid moved: the layout itself and everything
 * derived from which cell has the focus. Every mutation of the grid goes through here, so the
 * derived fields can never drift from the layout they are read off.
 */
const settledOn = (
    views: ProjectView[],
    viewLocal: Record<string, ProjectViewLocal>,
    layout: SplitLayout | null,
    was: Pick<DocumentState, 'lastCanvasViewId'>
): Pick<DocumentState, 'views' | 'viewLocal' | 'layout' | 'activeViewId' | 'lastCanvasViewId' | 'bodyFocused'> => {
    const activeViewId = layout === null ? null : focusedViewId(layout);
    const active = views.find((view) => view.id === activeViewId) ?? null;
    const canvas = active !== null && isCanvasView(active);
    return {
        views,
        viewLocal,
        layout,
        activeViewId,
        lastCanvasViewId: canvas ? activeViewId : was.lastCanvasViewId,
        /* A view of its own has no canvas to fall back to, so the keyboard starts inside its body.
           The files are in no document, hence the id rather than the view. */
        bodyFocused: activeViewId === FILES_VIEW_ID || (active !== null && !canvas)
    };
};

/* Whether an id may stand in a cell: an openable view of the document, or the files of this client. */
const canStandInCell = (views: readonly ProjectView[], id: string): boolean =>
    id === FILES_VIEW_ID || views.some((view) => view.id === id && isOpenableView(view));

/* Which view a banner would put on screen if its button were pressed; null for one that offers nothing. */
const noticeTarget = (notice: ViewNotice | null): string | null => {
    if (notice === null || notice.action === null) {
        return null;
    }
    return notice.action.kind === 'go' ? notice.action.viewId : notice.action.shown.replaced;
};

/* A banner whose button would open a view the project has not got any more is a door into nothing. */
const keptNotice = (notice: ViewNotice | null, views: ProjectView[]): ViewNotice | null => {
    const target = noticeTarget(notice);
    return target === null || views.some((view) => view.id === target) ? notice : null;
};

/*
 * A manual grid move makes an undo offer stale. A navigation offer survives until the requested
 * view becomes active; neither expires on a timer because the person may still need the action.
 */
const afterMove = (notice: ViewNotice | null, activeViewId: string | null): ViewNotice | null => {
    if (notice === null || notice.action === null) {
        return notice;
    }
    if (notice.action.kind === 'back') {
        return null;
    }
    return notice.action.viewId === activeViewId ? null : notice;
};

/*
 * Every view of the project that is open, and which one is on screen. The canvas store edits one
 * canvas view at a time; this store owns the list, hands the canvas its view on a switch and takes
 * the edits back before the next one loads.
 */
export const createDocumentStore = (peers: DocumentPeers): StoreApi<DocumentState> =>
    createStore<DocumentState>((set, get) => {
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
            openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), layout === null ? null : focusedViewId(layout), peers);
        };

        /* What the pure operations in contracts hand back: a new list, or null for a call that asked
           for what is already there, which claims no edit and so does not make the project dirty. */
        const write = (views: ProjectView[] | null): void => {
            if (views !== null) {
                set((state) => ({ views, edits: state.edits + 1, viewNotice: keptNotice(state.viewNotice, views) }));
            }
        };

        /* Takes a view out of the list and off the grid. A trashed one is no edit yet: the file keeps it until it is purged. */
        const removeView = (id: string, trash: boolean): boolean => {
            const state = get();
            const at = state.views.findIndex((view) => view.id === id);
            const result = withoutView(state.exportViews(), id);
            if (result === null) {
                return false;
            }
            const { views, removed } = result;
            const { [id]: local, ...viewLocal } = { ...state.viewLocal, ...state.exportLocal().views };
            const standing = state.layout === null ? null : locateView(state.layout, id);
            /* The cell it stood in falls away and the neighbors grow into it. Only when it was
               the last cell is a view picked: the nearest one under it, or the last one over it. */
            const next = views.slice(at).find(isOpenableView) ?? views.filter(isOpenableView).at(-1);
            const stood =
                state.layout === null || standing === null
                    ? null
                    : { before: state.layout, after: closeCell(state.layout, standing) ?? (next ? singleLayout(next.id) : null) };
            set({
                views,
                viewLocal,
                viewNotice: keptNotice(state.viewNotice, views),
                ...(trash ? { trashed: [...state.trashed, { view: removed, index: at, local, layout: stood }] } : { edits: state.edits + 1 })
            });
            if (stood !== null) {
                commit(stood.after);
            }
            return true;
        };

        /* A new view goes last in the list; everything but a divider opens on the spot. */
        const addView = (view: ProjectView, opens: boolean): string => {
            set((state) => ({ views: withView(state.exportViews(), view), edits: state.edits + 1 }));
            if (opens) {
                get().setActiveView(view.id);
            }
            return view.id;
        };

        return {
            views: [],
            activeViewId: null,
            layout: null,
            maximized: null,
            lastCanvasViewId: null,
            viewLocal: {},
            bodyFocused: false,
            viewNotice: null,
            edits: 0,
            loading: false,
            shared: [],
            flags: {},
            trashed: [],

            load(document, local) {
                const kept = splitTrash(document?.views ?? [], get().trashed);
                const views = kept.views;
                // A view deleted since the local state was written has nothing left to stand for.
                const viewLocal = Object.fromEntries(Object.entries(local?.views ?? {}).filter(([viewId]) => views.some((view) => view.id === viewId)));
                // A file written before views could stand side by side reads as one cell on the view it named.
                const layout = layoutOf(local ?? { activeViewId: null, layout: undefined }, views);
                const settled = settledOn(views, viewLocal, layout, { lastCanvasViewId: views.find(isCanvasView)?.id ?? null });
                // Another project is another set of views, so a banner about the one that just left goes with it.
                set({
                    ...settled,
                    maximized: null,
                    viewNotice: null,
                    loading: true,
                    edits: 0,
                    shared: document?.shared ?? [],
                    flags: document?.flags ?? {},
                    trashed: kept.trashed
                });
                // The project that was here goes first, editors and all, so nothing of it may show through.
                peers.canvases.keep([]);
                openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), settled.activeViewId, peers);
                set({ loading: false });
            },

            setShared(id, shared) {
                set((state) => {
                    const without = state.shared.filter((viewId) => viewId !== id);
                    return { shared: shared ? [...without, id] : without, edits: state.edits + 1 };
                });
            },

            setFlags(ids, color) {
                const flags = withFlags(get().flags, ids, color);
                if (flags !== null) {
                    set((state) => ({ flags, edits: state.edits + 1 }));
                }
            },

            applyMerge(merged, canvases, shared, flags) {
                const { views, trashed } = splitTrash(merged, get().trashed);
                set((state) => ({ views, shared, flags, trashed, viewNotice: keptNotice(state.viewNotice, views) }));
                for (const [viewId, patch] of Object.entries(canvases)) {
                    peers.canvases.peek(viewId)?.getState().applyExternal(patch);
                }
            },

            heldNodeIds() {
                return new Set(peers.canvases.live().flatMap(([, store]) => store.getState().heldNodeIds()));
            },

            setActiveView(id) {
                const state = get();
                if (!canStandInCell(state.views, id) || state.activeViewId === id) {
                    return;
                }
                if (state.layout === null) {
                    commit(singleLayout(id));
                    return;
                }
                const shown = showViewIn(state.layout, id);
                if (shown !== null) {
                    commit(shown.layout);
                }
            },

            showView(id) {
                const state = get();
                if (!canStandInCell(state.views, id)) {
                    return null;
                }
                if (state.layout === null) {
                    commit(singleLayout(id));
                    return null;
                }
                const shown = showViewIn(state.layout, id);
                if (shown !== null) {
                    commit(shown.layout);
                }
                return shown;
            },

            undoShowView(shown) {
                const state = get();
                if (state.layout !== null) {
                    commit(undoShowView(state.layout, shown));
                }
            },

            showNotice(notice) {
                // Only the newest agent request matters, and its move is the one an undo must reverse.
                set({ viewNotice: notice });
            },

            runNotice() {
                const action = get().viewNotice?.action ?? null;
                if (action === null) {
                    return;
                }
                set({ viewNotice: null });
                if (action.kind === 'go') {
                    get().setActiveView(action.viewId);
                    return;
                }
                get().undoShowView(action.shown);
            },

            dismissNotice() {
                set({ viewNotice: null });
            },

            dropViewAt(viewId, at, zone) {
                const state = get();
                if (state.layout === null || !canStandInCell(state.views, viewId) || !canSplit(state.layout, at, zone, viewId)) {
                    return;
                }
                commit(dropView(state.layout, viewId, at, zone));
            },

            showFiles() {
                const state = get();
                if (state.layout === null) {
                    commit(singleLayout(FILES_VIEW_ID));
                    return;
                }
                const standing = locateView(state.layout, FILES_VIEW_ID);
                if (standing !== null) {
                    if (!isSameCell(state.layout.focus, standing)) {
                        commit(focusCell(state.layout, standing));
                    }
                    return;
                }
                /* Beside what the person was working in, never over it: a chat in the one cell there
                   is would otherwise be gone behind a file they only meant to read. A grid at its
                   limit has no room beside, and there the cell does give way. */
                const at = state.layout.focus;
                const zone: SplitZone = canSplit(state.layout, at, 'right', FILES_VIEW_ID)
                    ? 'right'
                    : canSplit(state.layout, at, 'down', FILES_VIEW_ID)
                      ? 'down'
                      : 'center';
                commit(dropView(state.layout, FILES_VIEW_ID, at, zone));
            },

            hideFiles() {
                const state = get();
                const at = state.layout === null ? null : locateView(state.layout, FILES_VIEW_ID);
                if (at !== null) {
                    get().closeCellAt(at);
                }
            },

            splitFocused(direction, viewId) {
                const state = get();
                if (state.layout !== null) {
                    get().dropViewAt(viewId, state.layout.focus, direction);
                }
            },

            closeCellAt(at) {
                const state = get();
                if (state.layout === null) {
                    return;
                }
                // The last cell stays, since a project always has a view open, and an empty grid is not a state.
                const next = closeCell(state.layout, at);
                if (next !== null) {
                    commit(next);
                }
            },

            closeOtherCells(at) {
                const state = get();
                const next = state.layout === null ? null : closeOtherCells(state.layout, at);
                if (next !== null && next !== state.layout) {
                    commit(next);
                }
            },

            closeCellsRightOf(at) {
                const state = get();
                const next = state.layout === null ? null : closeCellsRightOf(state.layout, at);
                if (next !== null && next !== state.layout) {
                    commit(next);
                }
            },

            focusCellAt(at) {
                const state = get();
                // Asked on every press and every focus inside a cell, so the cell that already has it
                // costs nothing, since a commit writes every editor back.
                if (state.layout !== null && cellAt(state.layout, at) !== null && !isSameCell(state.layout.focus, at)) {
                    commit(focusCell(state.layout, at));
                }
            },

            toggleMaximized() {
                const state = get();
                if (state.maximized !== null) {
                    set({ maximized: null });
                    return;
                }
                if (state.layout !== null && cellCount(state.layout) > 1) {
                    set({ maximized: focusedViewId(state.layout) });
                }
            },

            focusTowards(direction) {
                const state = get();
                if (state.layout !== null) {
                    commit(focusDirection(state.layout, direction));
                }
            },

            /* A drag is not a move of the grid, since no editor opens or closes, so it sets the sizes alone. */
            resizeColumns(at, before, after) {
                set((state) => {
                    if (state.layout === null || at <= 0 || at >= state.layout.columns.length) {
                        return {};
                    }
                    const columns = state.layout.columns.map((column, index) =>
                        index === at - 1 ? { ...column, size: before } : index === at ? { ...column, size: after } : column
                    );
                    return { layout: { ...state.layout, columns } };
                });
            },

            resizeCells(column, at, before, after) {
                set((state) => {
                    const held = state.layout?.columns[column];
                    if (!state.layout || !held || at <= 0 || at >= held.cells.length) {
                        return {};
                    }
                    const cells = held.cells.map((cell, index) =>
                        index === at - 1 ? { ...cell, size: before } : index === at ? { ...cell, size: after } : cell
                    );
                    const columns = state.layout.columns.map((candidate, index) => (index === column ? { ...candidate, cells } : candidate));
                    return { layout: { ...state.layout, columns } };
                });
            },

            evenColumns(at, all) {
                set((state) => (state.layout === null ? {} : { layout: evenColumns(state.layout, at, all) }));
            },

            evenCells(column, at, all) {
                set((state) => (state.layout === null ? {} : { layout: evenCells(state.layout, column, at, all) }));
            },

            setBodyFocused(focused) {
                set({ bodyFocused: focused });
            },

            addCanvasView(name) {
                return addView(emptyCanvasView(nextId('view'), name), true);
            },

            addSeparatorView() {
                // A line in the list, not a place to go, so nothing opens on it.
                return addView({ kind: 'separator', id: nextId('separator') }, false);
            },

            addSubheaderView(name) {
                // A heading over the rows under it, which is a row that divides the list, not a place to go.
                return addView({ kind: 'subheader', id: nextId('subheader'), name }, false);
            },

            addDrawingView(name) {
                return addView({ kind: 'drawing', id: nextId('view'), name }, true);
            },

            addDiagramView(name) {
                return addView({ kind: 'diagram', id: nextId('view'), name }, true);
            },

            addFileView(name, path, opens = true) {
                return addView({ kind: 'file', id: nextId('view'), name, path }, opens);
            },

            addStandaloneView(request) {
                const id = request.id ?? nextId(request.kind);
                return addView(
                    request.kind === 'browser' || request.kind === 'device'
                        ? request.kind === 'browser'
                            ? { kind: 'browser', id, name: request.name, url: request.url }
                            : { kind: 'device', id, name: request.name, device: request.device }
                        : { kind: request.kind, id, name: request.name, node: request.node },
                    true
                );
            },

            renameView(id, name, source = 'user') {
                write(withRenamedView(get().views, id, name, source));
            },

            setViewIcon(id, icon) {
                write(withViewIcon(get().views, id, icon));
            },

            deleteView(id) {
                removeView(id, false);
            },

            trashView(id) {
                return removeView(id, true);
            },

            restoreView(id) {
                const state = get();
                const entry = state.trashed.find((candidate) => candidate.view.id === id);
                if (!entry) {
                    return false;
                }
                const views = [...state.exportViews()];
                views.splice(Math.min(entry.index, views.length), 0, entry.view);
                // One update, so the view is never in neither list and nothing watching reads it as gone.
                set({
                    views,
                    viewLocal: entry.local === undefined ? state.viewLocal : { ...state.viewLocal, [id]: entry.local },
                    trashed: state.trashed.filter((candidate) => candidate !== entry)
                });
                if (entry.layout === null) {
                    return true;
                }
                if (get().layout === entry.layout.after) {
                    commit(entry.layout.before);
                } else {
                    get().setActiveView(id);
                }
                return true;
            },

            purgeTrash(id) {
                const { trashed } = get();
                const going = trashed.filter((entry) => id === undefined || entry.view.id === id);
                if (going.length > 0) {
                    set((state) => ({ trashed: trashed.filter((entry) => !going.includes(entry)), edits: state.edits + 1 }));
                }
            },

            duplicateView(id) {
                const copy = withDuplicatedView(get().exportViews(), id, nextId);
                if (copy === null) {
                    return null;
                }
                write(copy.views);
                return copy.id;
            },

            moveView(id, toIndex) {
                write(withMovedView(get().exportViews(), id, toIndex));
            },

            moveNodeToView(nodeId, viewId) {
                const state = get();
                if (viewId === state.activeViewId) {
                    return;
                }
                const views = state.exportViews();
                const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
                const size = source && isCanvasView(source) ? source.nodes.find((candidate) => candidate.id === nodeId) : undefined;
                const moved = withNodeOnView(views, nodeId, viewId, centerOfView(viewId, state.viewLocal[viewId], size ?? { w: 0, h: 0 }, peers) ?? undefined);
                if (moved === null || !source) {
                    return;
                }
                write(moved.views);
                const editor = peers.canvases.peek(source.id);
                if (editor) {
                    // The canvas it left is on screen, so it has to lose the node without losing its camera.
                    const after = moved.views.find((view) => view.id === source.id);
                    editor.getState().loadView(after && isCanvasView(after) ? after : null, { camera: editor.getState().viewCamera(), focusedNodeId: null });
                }
            },

            renameNodeOnView(viewId, nodeId, title, source = 'user') {
                const editor = peers.canvases.peek(viewId);
                if (editor) {
                    editor.getState().renameNode(nodeId, title, source);
                    return;
                }
                write(withRenamedNode(get().views, viewId, nodeId, title, source));
            },

            updateStandalone(id, patch) {
                set((state) => ({
                    views: state.views.map((view) => {
                        if (view.id !== id || !isSessionView(view)) {
                            return view;
                        }
                        if (view.kind === 'browser') {
                            return patch.url === undefined ? view : { ...view, url: patch.url };
                        }
                        if (view.kind === 'device') {
                            return view;
                        }
                        const { url: _url, ...node } = patch;
                        return { ...view, node: { ...view.node, ...node } };
                    }),
                    edits: state.edits + 1
                }));
            },

            openAsView(nodeId) {
                const views = get().exportViews();
                const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
                const promoted = withNodeAsView(views, nodeId);
                if (promoted === null || !source) {
                    return null;
                }
                write(promoted.views);
                const editor = peers.canvases.peek(source.id);
                if (editor) {
                    const stripped = promoted.views.find((view) => view.id === source.id);
                    editor
                        .getState()
                        .loadView(stripped && isCanvasView(stripped) ? stripped : null, { camera: editor.getState().viewCamera(), focusedNodeId: null });
                }
                get().setActiveView(promoted.view.id);
                return promoted.view.id;
            },

            putOnCanvas(viewId, canvasViewId) {
                const state = get();
                const views = state.exportViews();
                const source = views.find((view) => view.id === viewId);
                const size = source && isSessionView(source) ? NODE_SIZE[source.kind] : { w: 0, h: 0 };
                const at = centerOfView(canvasViewId, state.viewLocal[canvasViewId], size, peers) ?? { x: 0, y: 0 };
                const landed = withViewAsNode(views, viewId, canvasViewId, at);
                if (landed === null) {
                    return false;
                }
                const { views: next, node } = landed;
                const { [viewId]: _gone, ...viewLocal } = state.viewLocal;
                set({ views: next, viewLocal, edits: state.edits + 1 });
                /* The view it was is gone from the list, so the cell it stood in takes the canvas it
                   landed on; from anywhere else the canvas simply comes up in the focused cell. */
                const standing = state.layout === null ? null : locateView(state.layout, viewId);
                if (state.layout !== null && standing !== null) {
                    commit(dropView(state.layout, canvasViewId, standing, 'center'));
                } else {
                    get().setActiveView(canvasViewId);
                }
                const editor = peers.canvases.peek(canvasViewId);
                editor?.getState().select([node.id]);
                editor?.getState().goToNode(node.id);
                return true;
            },

            exportViews() {
                const { views } = get();
                const live = peers.canvases.live();
                if (live.length === 0) {
                    return views;
                }
                // Every editor on screen writes itself back, not only the one the focus happens to be in.
                const content = new Map(live.map(([viewId, store]) => [viewId, store.getState().exportContent()]));
                return views.map((view) => {
                    const held = isCanvasView(view) ? content.get(view.id) : undefined;
                    return held ? { ...view, ...held } : view;
                });
            },

            fileViews() {
                const views = [...get().exportViews()];
                // Newest first, since each index was read off the list the older deletions had already left.
                for (const entry of [...get().trashed].reverse()) {
                    views.splice(Math.min(entry.index, views.length), 0, entry.view);
                }
                return views;
            },

            exportLocal() {
                const { activeViewId, viewLocal, views } = get();
                const open = new Set([
                    ...peers.canvases.live().map(([viewId]) => viewId),
                    ...peers.drawings.live().map(([viewId]) => viewId),
                    ...peers.diagrams.live().map(([viewId]) => viewId)
                ]);
                const next = { ...viewLocal };
                for (const viewId of open) {
                    next[viewId] = localOfView(
                        views.find((view) => view.id === viewId),
                        peers
                    );
                }
                return { activeViewId, views: next, ...(get().layout === null ? {} : { layout: get().layout! }) };
            }
        };
    });

export const defaultDocumentStore = createDocumentStore({ canvases: defaultCanvases, drawings: defaultDrawings, diagrams: defaultDiagrams });

export const useDocument = storeHook(defaultDocumentStore);

/*
 * Whether the cell a component is drawn in has the focus; true outside a cell. A body that takes the
 * keyboard asks this first, because a DOM focus in a cell beside it moves the grid's focus there.
 */
export const useCellHasFocus = (): boolean => {
    const cell = useContext(CellViewContext);
    return useDocument((s) => cell === null || s.activeViewId === cell);
};

/* The view a node sits on, so a jump from anywhere can switch to it first. */
export const viewOfNode = (views: ProjectView[], nodeId: string): ProjectView | null =>
    views.find((view) => (isCanvasView(view) ? view.nodes.some((node) => node.id === nodeId) : view.id === nodeId)) ?? null;

export const activeViewOf = (state: Pick<DocumentState, 'views' | 'activeViewId'>): ProjectView | null =>
    state.views.find((view) => view.id === state.activeViewId) ?? null;

export const hasActiveCanvas = (state: Pick<DocumentState, 'views' | 'activeViewId'>): boolean => {
    const view = activeViewOf(state);
    return view !== null && isCanvasView(view);
};
