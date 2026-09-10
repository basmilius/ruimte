import { create } from 'zustand';
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
    type ProjectLocal,
    type ProjectNode,
    type ProjectView,
    type ProjectViewLocal,
    type StandaloneNode
} from '@ruimte/contracts';
import { toWorld } from '@/canvas/math';
import { NODE_SIZE, nextId, useCanvas } from '@/state/canvas';
import { useDrawing } from '@/state/drawing';

export const emptyCanvasView = (id: string, name: string): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name,
    nodes: [],
    texts: [],
    edges: [],
    layouts: []
});

interface DocumentState {
    /* In sidebar order. The active canvas view is stale here: the canvas store is the editor of that one. */
    views: ProjectView[];
    activeViewId: string | null;
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
    setActiveView(id: string): void;
    setBodyFocused(focused: boolean): void;
    addCanvasView(name: string): string;
    /* A line in the sidebar with nothing behind it, to group the views around it. */
    addSeparatorView(): string;
    /* A sketch of its own. Its elements live in a file of their own, which the daemon keeps. */
    addDrawingView(name: string): string;
    /* A chat, terminal or browser without a canvas under it. The id is the session id, as for a node. */
    addStandaloneView(view: StandaloneRequest): string;
    renameView(id: string, name: string, source?: NodeTitleSource | null): void;
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
    exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views'>;
}

/* What a new standalone view needs: a chat and a terminal carry a node, a browser carries a page. */
export type StandaloneRequest =
    { kind: 'chat' | 'terminal'; name: string; id?: string; node: StandaloneNode } | { kind: 'browser'; name: string; id?: string; url: string };

/* Where the view that is on screen stands. A drawing keeps its camera in its own store. */
const localOfActive = (view: ProjectView | undefined): ProjectViewLocal => {
    if (view && isDrawingView(view)) {
        return { camera: useDrawing.getState().camera, focusedNodeId: null };
    }
    const { camera, mode } = useCanvas.getState();
    return { camera, focusedNodeId: mode.kind === 'node' ? mode.nodeId : null };
};

/* Where a node lands when it moves to another view: the middle of what that view last looked at. */
const centerOfView = (local: ProjectViewLocal | undefined, node: { w: number; h: number }): { x: number; y: number } | null => {
    const { viewport } = useCanvas.getState();
    if (!local?.camera || viewport.w === 0) {
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
 * Every view of the project that is open, and which one is on screen. The canvas store edits one
 * canvas view at a time; this store owns the list, hands the canvas its view on a switch and takes
 * the edits back before the next one loads.
 */
export const useDocument = create<DocumentState>((set, get) => ({
    views: [],
    activeViewId: null,
    lastCanvasViewId: null,
    viewLocal: {},
    bodyFocused: false,
    edits: 0,
    loading: false,

    load(document, local) {
        const views = document?.views ?? [];
        const viewLocal = local?.views ?? {};
        const active = views.find((view) => view.id === local?.activeViewId && isOpenableView(view)) ?? views.find(isOpenableView) ?? null;
        const canvas = active && isCanvasView(active) ? active : null;
        set({
            loading: true,
            views,
            activeViewId: active?.id ?? null,
            lastCanvasViewId: canvas?.id ?? views.find(isCanvasView)?.id ?? null,
            viewLocal,
            bodyFocused: active !== null && canvas === null,
            edits: 0
        });
        useCanvas.getState().loadView(canvas, active ? (viewLocal[active.id] ?? null) : null);
        set({ loading: false });
    },

    setActiveView(id) {
        const state = get();
        const next = state.views.find((view) => view.id === id);
        if (!next || !isOpenableView(next) || state.activeViewId === id) {
            return;
        }
        const views = state.exportViews();
        const previous = state.views.find((view) => view.id === state.activeViewId);
        const viewLocal = state.activeViewId ? { ...state.viewLocal, [state.activeViewId]: localOfActive(previous) } : state.viewLocal;
        const canvas = isCanvasView(next);
        // A view of its own has no canvas to fall back to, so the keyboard starts inside its body.
        set({ views, viewLocal, activeViewId: id, lastCanvasViewId: canvas ? id : state.lastCanvasViewId, bodyFocused: !canvas });
        useCanvas.getState().loadView(canvas ? next : null, viewLocal[id] ?? null);
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
        if (state.activeViewId === id) {
            // The nearest view under the one that went, or the last one over it.
            const next = views.slice(at).find(isOpenableView) ?? views.filter(isOpenableView).at(-1)!;
            set({ activeViewId: null });
            get().setActiveView(next.id);
        }
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
        const placed = { ...node, ...(centerOfView(state.viewLocal[viewId], node) ?? {}) };
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
        if (source.id === state.activeViewId) {
            const active = next.find((view) => view.id === state.activeViewId);
            useCanvas.getState().loadView(active && isCanvasView(active) ? active : null, { camera: useCanvas.getState().camera, focusedNodeId: null });
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
        if (source.id === state.activeViewId) {
            useCanvas.getState().loadView(stripped, { camera: useCanvas.getState().camera, focusedNodeId: null });
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
            ...(centerOfView(state.viewLocal[canvasViewId], size) ?? { x: 0, y: 0 }),
            ...size,
            ...(source.kind === 'browser' ? { url: source.url } : source.node)
        };
        const next = views
            .filter((view) => view.id !== viewId)
            .map((view) => (view.id === canvasViewId && isCanvasView(view) ? { ...view, nodes: [...view.nodes, node] } : view));
        const { [viewId]: _gone, ...viewLocal } = state.viewLocal;
        set({ views: next, viewLocal, activeViewId: null, edits: state.edits + 1 });
        get().setActiveView(canvasViewId);
        useCanvas.getState().select([node.id]);
        useCanvas.getState().goToNode(node.id);
        return true;
    },

    exportViews() {
        const { views, activeViewId } = get();
        const active = views.find((view) => view.id === activeViewId);
        if (!active || !isCanvasView(active)) {
            return views;
        }
        const content = useCanvas.getState().exportContent();
        return views.map((view) => (view.id === activeViewId ? { ...view, ...content } : view));
    },

    exportLocal() {
        const { activeViewId, viewLocal, views } = get();
        const active = views.find((view) => view.id === activeViewId);
        return {
            activeViewId,
            views: activeViewId ? { ...viewLocal, [activeViewId]: localOfActive(active) } : viewLocal
        };
    }
}));

/* The view a node sits on, so a jump from anywhere can switch to it first. */
export const viewOfNode = (views: ProjectView[], nodeId: string): ProjectView | null =>
    views.find((view) => (isCanvasView(view) ? view.nodes.some((node) => node.id === nodeId) : view.id === nodeId)) ?? null;

export const activeViewOf = (state: Pick<DocumentState, 'views' | 'activeViewId'>): ProjectView | null =>
    state.views.find((view) => view.id === state.activeViewId) ?? null;
