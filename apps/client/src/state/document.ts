import { createStore, type StoreApi } from 'zustand';
import type { SplitLayout } from '@ruimte/contracts';
import {
    MAIN_VIEW_ID,
    MAIN_VIEW_NAME,
    isCanvasView,
    isDrawingView,
    isOpenableView,
    isSessionView,
    type NodeTitleSource,
    type ProjectCanvasView,
    type ProjectDocument,
    type ProjectIconChoice,
    type ProjectLocal,
    type ProjectNode,
    type ProjectView,
    type ProjectViewLocal,
    type StandaloneNode
} from '@ruimte/contracts';
import { toWorld } from '@/canvas/math';
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
    singleLayout,
    viewIdsIn,
    type CellAt,
    type SplitDirection,
    type SplitZone
} from '@/shell/split';
import { workspaceHook } from '@/state/workspace-stores';

export const emptyCanvasView = (id: string, name: string): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name,
    nodes: [],
    texts: [],
    edges: [],
    layouts: []
});

export interface DocumentState {
    /* In sidebar order. The active canvas view is stale here: the canvas store is the editor of that one. */
    views: ProjectView[];
    /*
     * The view of the cell that has the focus. It is derived from the layout and kept beside it,
     * because it is what the sidebar marks, what a chord acts on and what everything outside the
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
        return { camera: peers.drawings.peek(view.id)?.getState().camera ?? null, focusedNodeId: null };
    }
    const canvas = canvasOf(view?.id, peers);
    return canvas === null
        ? { camera: null, focusedNodeId: null }
        : { camera: canvas.camera, focusedNodeId: canvas.mode.kind === 'node' ? canvas.mode.nodeId : null };
};

/*
 * Where a node lands when it moves to another view: the middle of what that view last looked at. The
 * window it is measured against is that view's own cell when it has one, and otherwise any canvas on
 * screen, because a view that is not up has no size of its own to place anything in.
 */
const centerOfView = (
    viewId: string,
    local: ProjectViewLocal | undefined,
    node: { w: number; h: number },
    peers: DocumentPeers
): { x: number; y: number } | null => {
    const viewport = (canvasOf(viewId, peers) ?? peers.canvases.live()[0]?.[1].getState())?.viewport;
    if (!local?.camera || !viewport || viewport.w === 0) {
        return null;
    }
    const middle = toWorld(local.camera, { x: viewport.w / 2, y: viewport.h / 2 });
    return { x: Math.round(middle.x - node.w / 2), y: Math.round(middle.y - node.h / 2) };
};

/* A copy is a new node with a new session, so every id inside the view is renamed along with it. */
const copyOfCanvas = (view: ProjectCanvasView, name: string): ProjectCanvasView => {
    const renamed = new Map<string, string>();
    for (const node of view.nodes) {
        renamed.set(node.id, nextId(node.kind));
    }
    for (const text of view.texts) {
        renamed.set(text.id, nextId('text'));
    }
    const idOf = (id: string): string => renamed.get(id) ?? id;
    const remap = <T>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(record).map(([id, value]) => [idOf(id), value]));
    return {
        kind: 'canvas',
        id: nextId('view'),
        name,
        nodes: view.nodes.map((node) => ({
            ...node,
            id: idOf(node.id),
            resume: undefined,
            memberIds: node.memberIds?.map(idOf)
        })),
        texts: view.texts.map((text) => ({ ...text, id: idOf(text.id) })),
        edges: view.edges.map((edge) => ({ ...edge, id: nextId('edge'), from: idOf(edge.from), to: idOf(edge.to) })),
        layouts: view.layouts.map((layout) => ({ ...layout, nodes: remap(layout.nodes), texts: remap(layout.texts) }))
    };
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
            set(settledOn(views, viewLocal, layout, state));
            openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), layout === null ? null : focusedViewId(layout), peers);
        };

        return {
            views: [],
            activeViewId: null,
            layout: null,
            lastCanvasViewId: null,
            viewLocal: {},
            bodyFocused: false,
            edits: 0,
            loading: false,

            load(document, local) {
                const views = document?.views ?? [];
                const viewLocal = local?.views ?? {};
                // A file written before views could stand side by side reads as one cell on the view it named.
                const layout = layoutOf(local ?? { activeViewId: null, layout: undefined }, views);
                const settled = settledOn(views, viewLocal, layout, { lastCanvasViewId: views.find(isCanvasView)?.id ?? null });
                set({ ...settled, loading: true, edits: 0 });
                // The project that was here goes first, editors and all: nothing of it may show through.
                peers.canvases.keep([]);
                openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), settled.activeViewId, peers);
                set({ loading: false });
            },

            applyAdditions(views, canvases) {
                set({ views });
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
                // Already in a cell: the view does not move, the focus goes to it. Otherwise it takes the
                // place of the view in the focused cell, which is what one cell has always done.
                const standing = locateView(state.layout, id);
                commit(standing === null ? dropView(state.layout, id, state.layout.focus, 'center') : focusCell(state.layout, standing));
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
                const view = emptyCanvasView(nextId('view'), name);
                set((state) => ({ views: [...state.exportViews(), view], edits: state.edits + 1 }));
                get().setActiveView(view.id);
                return view.id;
            },

            addSeparatorView() {
                const view: ProjectView = { kind: 'separator', id: nextId('separator') };
                set((state) => ({ views: [...state.exportViews(), view], edits: state.edits + 1 }));
                return view.id;
            },

            addDrawingView(name) {
                const view: ProjectView = { kind: 'drawing', id: nextId('view'), name };
                set((state) => ({ views: [...state.exportViews(), view], edits: state.edits + 1 }));
                get().setActiveView(view.id);
                return view.id;
            },

            addFileView(name, path) {
                const view: ProjectView = { kind: 'file', id: nextId('view'), name, path };
                set((state) => ({ views: [...state.exportViews(), view], edits: state.edits + 1 }));
                get().setActiveView(view.id);
                return view.id;
            },

            addStandaloneView(request) {
                const id = request.id ?? nextId(request.kind);
                const view: ProjectView =
                    request.kind === 'browser'
                        ? { kind: 'browser', id, name: request.name, url: request.url }
                        : { kind: request.kind, id, name: request.name, node: request.node };
                set((state) => ({ views: [...state.exportViews(), view], edits: state.edits + 1 }));
                get().setActiveView(id);
                return id;
            },

            renameView(id, name, source = 'user') {
                const current = get().views.find((view) => view.id === id);
                // A separator is a bare line and wears no name, so there is nothing a rename could change.
                if (current?.kind === 'separator') {
                    return;
                }
                // A rename that changes nothing claims nothing, so a page that reopens on its own name is no edit.
                if (current && current.name === name && (current.titleSource ?? null) === source) {
                    return;
                }
                set((state) => ({
                    views: state.views.map((view) => (view.id === id ? { ...view, name, titleSource: source ?? undefined } : view)),
                    edits: state.edits + 1
                }));
            },

            setViewIcon(id, icon) {
                const current = get().views.find((view) => view.id === id);
                // A separator is a bare line with no room for a mark, so there is nothing to override.
                if (!current || current.kind === 'separator') {
                    return;
                }
                if ((current.icon ?? null) === null && icon === null) {
                    return;
                }
                set((state) => ({
                    views: state.views.map((view) => (view.id === id ? { ...view, icon: icon ?? undefined } : view)),
                    edits: state.edits + 1
                }));
            },

            deleteView(id) {
                const state = get();
                const at = state.views.findIndex((view) => view.id === id);
                if (at === -1) {
                    return;
                }
                const rest = state.exportViews().filter((view) => view.id !== id);
                // A project always has a view to open, so taking the last one leaves an empty canvas behind;
                // separators alone are a list of lines with nowhere to go.
                const views = rest.some(isOpenableView) ? rest : [...rest, emptyCanvasView(MAIN_VIEW_ID, MAIN_VIEW_NAME)];
                const { [id]: _gone, ...viewLocal } = state.viewLocal;
                set({ views, viewLocal, edits: state.edits + 1 });
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
                const state = get();
                const source = state.exportViews().find((view) => view.id === id);
                if (!source || (!isCanvasView(source) && !isDrawingView(source))) {
                    return null;
                }
                // A drawing view holds nothing itself; the daemon copies the file it points at.
                const copy: ProjectView = isCanvasView(source)
                    ? copyOfCanvas(source, `${source.name} copy`)
                    : { kind: 'drawing', id: nextId('view'), name: `${source.name} copy` };
                const at = state.views.findIndex((view) => view.id === id);
                const views = state.exportViews();
                set({ views: [...views.slice(0, at + 1), copy, ...views.slice(at + 1)], edits: state.edits + 1 });
                return copy.id;
            },

            moveView(id, toIndex) {
                const state = get();
                const views = state.exportViews();
                const at = views.findIndex((view) => view.id === id);
                if (at === -1 || toIndex === at) {
                    return;
                }
                const rest = views.filter((view) => view.id !== id);
                rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, views[at]!);
                set({ views: rest, edits: state.edits + 1 });
            },

            moveNodeToView(nodeId, viewId) {
                const state = get();
                const target = state.views.find((view) => view.id === viewId);
                if (!target || !isCanvasView(target) || viewId === state.activeViewId) {
                    return;
                }
                const views = state.exportViews();
                const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
                if (!source || !isCanvasView(source)) {
                    return;
                }
                const node = source.nodes.find((candidate) => candidate.id === nodeId)!;
                const placed = { ...node, ...(centerOfView(viewId, state.viewLocal[viewId], node, peers) ?? {}) };
                const next = views.map((view) => {
                    if (view.id === source.id && isCanvasView(view)) {
                        // The lines it was part of stay behind: an edge lives on one canvas.
                        return {
                            ...view,
                            nodes: view.nodes.filter((candidate) => candidate.id !== nodeId),
                            edges: view.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
                        };
                    }
                    return view.id === viewId && isCanvasView(view) ? { ...view, nodes: [...view.nodes, placed] } : view;
                });
                set({ views: next, edits: state.edits + 1 });
                const editor = peers.canvases.peek(source.id);
                if (editor) {
                    // The canvas it left is on screen, so it has to lose the node without losing its camera.
                    const after = next.find((view) => view.id === source.id);
                    editor.getState().loadView(after && isCanvasView(after) ? after : null, { camera: editor.getState().camera, focusedNodeId: null });
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
                const state = get();
                const views = state.exportViews();
                const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
                if (!source || !isCanvasView(source)) {
                    return null;
                }
                const node = source.nodes.find((candidate) => candidate.id === nodeId)!;
                if (node.kind !== 'chat' && node.kind !== 'terminal' && node.kind !== 'browser') {
                    return null;
                }
                const view: ProjectView =
                    node.kind === 'browser'
                        ? { kind: 'browser', id: node.id, name: node.title, url: node.url ?? '' }
                        : {
                              kind: node.kind,
                              id: node.id,
                              name: node.title,
                              node: {
                                  cwd: node.cwd,
                                  command: node.command,
                                  resume: node.resume,
                                  provider: node.provider,
                                  providerFixed: node.providerFixed,
                                  runtimeMode: node.runtimeMode,
                                  accent: node.accent
                              }
                          };
                const at = views.findIndex((candidate) => candidate.id === source.id);
                // The lines it was part of stay behind: an edge lives on one canvas, and this leaves that canvas.
                const stripped = {
                    ...source,
                    nodes: source.nodes.filter((candidate) => candidate.id !== nodeId),
                    edges: source.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
                };
                const next = views.map((candidate) => (candidate.id === source.id ? stripped : candidate));
                next.splice(at + 1, 0, view);
                set({ views: next, edits: state.edits + 1 });
                const editor = peers.canvases.peek(source.id);
                if (editor) {
                    editor.getState().loadView(stripped, { camera: editor.getState().camera, focusedNodeId: null });
                }
                get().setActiveView(view.id);
                return view.id;
            },

            putOnCanvas(viewId, canvasViewId) {
                const state = get();
                const views = state.exportViews();
                const source = views.find((view) => view.id === viewId);
                const target = views.find((view) => view.id === canvasViewId);
                // A drawing is a file, not a session, so it is mirrored onto a canvas instead of moved there.
                if (!source || !isSessionView(source) || !target || !isCanvasView(target)) {
                    return false;
                }
                const size = NODE_SIZE[source.kind];
                const node: ProjectNode = {
                    id: source.id,
                    kind: source.kind,
                    title: source.name,
                    ...(centerOfView(canvasViewId, state.viewLocal[canvasViewId], size, peers) ?? { x: 0, y: 0 }),
                    ...size,
                    ...(source.kind === 'browser' ? { url: source.url } : source.node)
                };
                const next = views
                    .filter((view) => view.id !== viewId)
                    .map((view) => (view.id === canvasViewId && isCanvasView(view) ? { ...view, nodes: [...view.nodes, node] } : view));
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
