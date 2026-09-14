import { createStore, type StoreApi } from 'zustand';
import type { SplitLayout } from '@ruimte/contracts';
import {
    emptyCanvasView,
    isCanvasView,
    isDrawingView,
    isOpenableView,
    isSessionView,
    withDuplicatedView,
    withMovedView,
    withNodeAsView,
    withNodeOnView,
    withRenamedView,
    withView,
    withViewAsNode,
    withViewIcon,
    withoutView,
    type NodeTitleSource,
    type ProjectDocument,
    type ProjectIconChoice,
    type ProjectLocal,
    type ProjectView,
    type ProjectViewLocal,
    type StandaloneNode
} from '@ruimte/contracts';
import type { CanvasAddition } from '@/project/merge';
import { NODE_SIZE, defaultCanvases, nextId, type CanvasState } from '@/state/canvas';
import { defaultDrawings, type DrawingState } from '@/state/drawing';
import type { EditorRegistry } from '@/state/editors';
import {
    canSplit,
    cellAt,
    closeCell,
    dropView,
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
import { workspaceHook } from '@/state/workspace-stores';

export interface DocumentState {
    /* In sidebar order. The active canvas view is stale here: the canvas store is the editor of that one. */
    views: ProjectView[];
    /*
     * The view of the cell that has the focus. It is derived from the layout and kept beside it,
     * because it is what the sidebar marks, what a shortcut acts on and what everything outside the
     * grid means by "the view": one answer to a question that is asked from everywhere.
     */
    activeViewId: string | null;
    /* How the views stand beside each other on this machine. Null while no view is open at all. */
    layout: SplitLayout | null;
    /* The canvas that was up last, which is where a node put back on a canvas lands. */
    lastCanvasViewId: string | null;
    /* Machine state beside the document, never in the shared file: where every view stood. */
    viewLocal: Record<string, ProjectViewLocal>;
    /* Whether the keyboard is inside the body of a standalone view; Escape leaves it to the sidebar. */
    bodyFocused: boolean;
    /* What an agent's `open` left on the banner over the views, in either setting. Null when there is
       nothing to say; one at a time, since the last thing an agent asked for is the one worth acting on. */
    viewNotice: ViewNotice | null;
    /* Counts changes to the document itself. Switching views writes the canvas back, which is not one. */
    edits: number;
    /* True for the one update that swaps in another project, so nobody reads it as edits. */
    loading: boolean;

    load(document: ProjectDocument | null, local: ProjectLocal | null): void;
    /*
     * What another writer added, taken in beside what this machine is editing: the views it does not
     * have, and what the canvases it does have gained. Not an edit, since it is already on disk, and
     * no view opens by itself: a person's grid only moves when the person moves it.
     */
    applyAdditions(views: ProjectView[], canvases: Record<string, CanvasAddition>): void;
    /* Puts a view in the cell that has the focus, or moves the focus to the cell it already stands in. */
    setActiveView(id: string): void;
    /* The same, for a view someone else asked for: it answers what moved, so a toast can put it back.
       Null when nothing moved, which is a view this document does not have or the one already in front. */
    showView(id: string): ShownView | null;
    /* The way back out of that toast, run against the grid as it stands when the button is pressed. */
    undoShowView(shown: Omit<ShownView, 'layout'>): void;
    /* What an agent's `open` has to say, put in the banner over whatever was standing in it. */
    showNotice(notice: ViewNotice): void;
    /* The button on that banner, whichever of the two it is. It takes the banner off the screen as
       well, which is what a card with a button has to do: leaving it up after the press reads as a
       press that did nothing. */
    runNotice(): void;
    dismissNotice(): void;
    /* A view into a cell's zone: the four edges split, the middle takes the place of what is there. */
    dropViewAt(viewId: string, at: CellAt, zone: SplitZone): void;
    /* Splits the focused cell and puts a view in the new one. */
    splitFocused(direction: SplitDirection, viewId: string): void;
    /* Takes a cell off the grid; the neighbors grow into it. The last cell stays, there has to be one. */
    closeCellAt(at: CellAt): void;
    focusCellAt(at: CellAt): void;
    /* The focus one cell along, which is how a grid is navigated: by direction, never by number. */
    focusTowards(direction: SplitDirection): void;
    /* A splitter dragged between two columns or two cells; the shares are of the axis they share. */
    resizeColumns(at: number, before: number, after: number): void;
    resizeCells(column: number, at: number, before: number, after: number): void;
    setBodyFocused(focused: boolean): void;
    addCanvasView(name: string): string;
    /* A line in the sidebar with nothing behind it, to group the views around it. */
    addSeparatorView(): string;
    /* A sketch of its own. Its elements live in a file of their own, which the daemon keeps. */
    addDrawingView(name: string): string;
    /* One file on disk, read and never written. The path is all it holds. */
    addFileView(name: string, path: string): string;
    /* A chat, terminal or browser without a canvas under it. The id is the session id, as for a node. */
    addStandaloneView(view: StandaloneRequest): string;
    renameView(id: string, name: string, source?: NodeTitleSource | null): void;
    /* Overrules the mark a view wears in the lists; null hands it back to its kind. */
    setViewIcon(id: string, icon: ProjectIconChoice | null): void;
    deleteView(id: string): void;
    duplicateView(id: string): string | null;
    moveView(id: string, toIndex: number): void;
    /* Moves a node from the canvas it sits on to another canvas view, keeping its id and its session. */
    moveNodeToView(nodeId: string, viewId: string): void;
    /* Changes what a standalone view carries (its folder, its page) without touching the list. */
    updateStandalone(id: string, patch: Partial<StandaloneNode> & { url?: string }): void;
    /* Lifts a node off its canvas into a view of its own, id and session included. */
    openAsView(nodeId: string): string | null;
    /* Puts a standalone view back on a canvas as a node, in the middle of what that canvas looked at. */
    putOnCanvas(viewId: string, canvasViewId: string): boolean;

    /* The views as they would be saved: the canvas on screen written back into the view it belongs to. */
    exportViews(): ProjectView[];
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

/* What a new standalone view needs: a chat and a terminal carry a node, a browser carries a page. */
export type StandaloneRequest =
    { kind: 'chat' | 'terminal'; name: string; id?: string; node: StandaloneNode } | { kind: 'browser'; name: string; id?: string; url: string };

/*
 * The editors of the same workspace, handed in rather than imported, so a second project on screen
 * moves its own views into its own editors instead of into the ones that have the focus. They are
 * registries: the document decides which views are on screen, and an editor exists for exactly those.
 */
export interface DocumentPeers {
    canvases: EditorRegistry<CanvasState>;
    drawings: EditorRegistry<DrawingState>;
}

/* What a view holds right now: its editor while it is on screen, the document's copy otherwise. */
const canvasOf = (viewId: string | null | undefined, peers: DocumentPeers): CanvasState | null =>
    (viewId === null || viewId === undefined ? null : peers.canvases.peek(viewId)?.getState()) ?? null;

/*
 * Opens the editors of the views on screen and lets go of the rest. An editor is filled the moment
 * it is made, so nothing ever reads one that is empty while its view has nodes; a view that is not a
 * canvas simply gets none, which is what the single store stood for when a chat was up.
 *
 * Only the canvases are let go of here. A drawing is a file of its own, and its editor is the
 * `DrawingClient`'s: releasing one it has not written out yet would hand it an empty store to save.
 * The focus is mirrored onto both, since that is what a reader outside the grid resolves through.
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
};

/* Where a view on screen stands. A drawing keeps its camera in its own editor, a canvas in its own. */
const localOfView = (view: ProjectView | undefined, peers: DocumentPeers): ProjectViewLocal => {
    if (view && isDrawingView(view)) {
        return { camera: peers.drawings.peek(view.id)?.getState().viewCamera() ?? null, focusedNodeId: null };
    }
    const canvas = canvasOf(view?.id, peers);
    return canvas === null
        ? { camera: null, focusedNodeId: null }
        : { camera: canvas.viewCamera(), focusedNodeId: canvas.mode.kind === 'node' ? canvas.mode.nodeId : null };
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
        // A view of its own has no canvas to fall back to, so the keyboard starts inside its body.
        bodyFocused: active !== null && !canvas
    };
};

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
 * What a grid that just moved does to the banner standing over it. A way back describes the grid as
 * it was, so the moment a person moves the grid themselves they have answered the question and the
 * offer is stale; a request to look somewhere survives that, unless the move is the person arriving
 * there, which is the request answered by doing it. That is the whole of when a banner goes by
 * itself: no timer, because four seconds of a view you did not ask for is exactly when you would
 * reach for the way back.
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
            set({ ...settled, viewNotice: afterMove(state.viewNotice, settled.activeViewId) });
            openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), layout === null ? null : focusedViewId(layout), peers);
        };

        /* What the pure operations in contracts hand back: a new list, or null for a call that asked
           for what is already there, which claims no edit and so does not make the project dirty. */
        const write = (views: ProjectView[] | null): void => {
            if (views !== null) {
                set((state) => ({ views, edits: state.edits + 1, viewNotice: keptNotice(state.viewNotice, views) }));
            }
        };

        /* A new view goes last in the list; everything but a separator opens on the spot. */
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
            lastCanvasViewId: null,
            viewLocal: {},
            bodyFocused: false,
            viewNotice: null,
            edits: 0,
            loading: false,

            load(document, local) {
                const views = document?.views ?? [];
                // A view deleted since the local state was written has nothing left to stand for.
                const viewLocal = Object.fromEntries(Object.entries(local?.views ?? {}).filter(([viewId]) => views.some((view) => view.id === viewId)));
                // A file written before views could stand side by side reads as one cell on the view it named.
                const layout = layoutOf(local ?? { activeViewId: null, layout: undefined }, views);
                const settled = settledOn(views, viewLocal, layout, { lastCanvasViewId: views.find(isCanvasView)?.id ?? null });
                // Another project is another set of views, so a banner about the one that just left goes with it.
                set({ ...settled, viewNotice: null, loading: true, edits: 0 });
                // The project that was here goes first, editors and all: nothing of it may show through.
                peers.canvases.keep([]);
                openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), settled.activeViewId, peers);
                set({ loading: false });
            },

            applyAdditions(views, canvases) {
                set((state) => ({ views, viewNotice: keptNotice(state.viewNotice, views) }));
                for (const [viewId, addition] of Object.entries(canvases)) {
                    peers.canvases.peek(viewId)?.getState().addExternal(addition);
                }
            },

            setActiveView(id) {
                const state = get();
                const next = state.views.find((view) => view.id === id);
                if (!next || !isOpenableView(next) || state.activeViewId === id) {
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
                const view = state.views.find((candidate) => candidate.id === id);
                if (!view || !isOpenableView(view)) {
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
                // The one that was up is replaced rather than queued: an agent that opens twice means
                // the second one, and a line of old requests is a list nobody would work through. The
                // way back goes with it, since it is the second move that is now the one to undo.
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
                const view = state.views.find((candidate) => candidate.id === viewId);
                if (state.layout === null || !view || !isOpenableView(view) || !canSplit(state.layout, at, zone, viewId)) {
                    return;
                }
                commit(dropView(state.layout, viewId, at, zone));
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
                // The last cell stays: a project always has a view open, and an empty grid is not a state.
                const next = closeCell(state.layout, at);
                if (next !== null) {
                    commit(next);
                }
            },

            focusCellAt(at) {
                const state = get();
                // Asked on every press and every focus inside a cell, so the cell that already has it
                // costs nothing: a commit writes every editor back.
                if (state.layout !== null && cellAt(state.layout, at) !== null && !isSameCell(state.layout.focus, at)) {
                    commit(focusCell(state.layout, at));
                }
            },

            focusTowards(direction) {
                const state = get();
                if (state.layout !== null) {
                    commit(focusDirection(state.layout, direction));
                }
            },

            /* A drag is not a move of the grid: no editor opens or closes, so it sets the sizes alone. */
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

            addDrawingView(name) {
                return addView({ kind: 'drawing', id: nextId('view'), name }, true);
            },

            addFileView(name, path) {
                return addView({ kind: 'file', id: nextId('view'), name, path }, true);
            },

            addStandaloneView(request) {
                const id = request.id ?? nextId(request.kind);
                return addView(
                    request.kind === 'browser'
                        ? { kind: 'browser', id, name: request.name, url: request.url }
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
                const state = get();
                const at = state.views.findIndex((view) => view.id === id);
                const result = withoutView(state.exportViews(), id);
                if (result === null) {
                    return;
                }
                const { views } = result;
                const { [id]: _gone, ...viewLocal } = state.viewLocal;
                set({ views, viewLocal, edits: state.edits + 1, viewNotice: keptNotice(state.viewNotice, views) });
                const standing = state.layout === null ? null : locateView(state.layout, id);
                if (state.layout === null || standing === null) {
                    return;
                }
                /* The cell it stood in falls away and the neighbors grow into it. Only when it was
                   the last cell is a view picked: the nearest one under it, or the last one over it. */
                const next = views.slice(at).find(isOpenableView) ?? views.filter(isOpenableView).at(-1)!;
                commit(closeCell(state.layout, standing) ?? singleLayout(next.id));
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

            updateStandalone(id, patch) {
                set((state) => ({
                    views: state.views.map((view) => {
                        if (view.id !== id || !isSessionView(view)) {
                            return view;
                        }
                        if (view.kind === 'browser') {
                            return patch.url === undefined ? view : { ...view, url: patch.url };
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

            exportLocal() {
                const { activeViewId, viewLocal, views } = get();
                const open = new Set([...peers.canvases.live().map(([viewId]) => viewId), ...peers.drawings.live().map(([viewId]) => viewId)]);
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

export const defaultDocumentStore = createDocumentStore({ canvases: defaultCanvases, drawings: defaultDrawings });

export const useDocument = workspaceHook('document', defaultDocumentStore);

/* The view a node sits on, so a jump from anywhere can switch to it first. */
export const viewOfNode = (views: ProjectView[], nodeId: string): ProjectView | null =>
    views.find((view) => (isCanvasView(view) ? view.nodes.some((node) => node.id === nodeId) : view.id === nodeId)) ?? null;

export const activeViewOf = (state: Pick<DocumentState, 'views' | 'activeViewId'>): ProjectView | null =>
    state.views.find((view) => view.id === state.activeViewId) ?? null;
