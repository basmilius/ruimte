import { createStore, type StoreApi } from 'zustand';
import {
    EMPTY_DIAGRAM,
    type DiagramContent,
    type DiagramDocument,
    type DiagramNode,
    type DrawingColor,
    type ProjectViewLocal,
    type ViewCamera
} from '@ruimte/contracts';
import { layoutOf, type DiagramLayout } from '@ruimte/diagram';
import { cameraOfView, cameraToFit, clampZoom, isMeasured, snapZoom, viewCameraOf, zoomAround, type Camera, type Point } from '@/canvas/math';
import type { CameraRequest } from '@/state/canvas';
import { createEditorRegistry, type EditorRegistry } from '@/state/editors';
import { currentStores, editorHook, focusedEditor, subscribeCurrentWorkspace, useEditorStoreOf } from '@/state/workspace-stores';

interface Viewport {
    w: number;
    h: number;
}

export interface DiagramState {
    /* The diagram view this store holds, or null while none is on screen. */
    viewId: string | null;
    camera: Camera;
    viewport: Viewport;
    content: DiagramContent;
    /* Computed from `content` whenever it changes, so a render never lays the graph out itself. */
    layout: DiagramLayout;
    rev: number;
    dirty: boolean;
    /* Counts changes to the content, which is what the client saves on. */
    edits: number;
    /* What undo and redo step through: whole contents, since a diagram is a few dozen entries. */
    past: DiagramContent[];
    future: DiagramContent[];
    loading: boolean;
    /* Where the camera goes the moment the diagram has a size. */
    pendingCamera: Extract<CameraRequest, { kind: 'fit' | 'view' }> | null;
    conflict: DiagramDocument | null;
    error: string | null;

    load(viewId: string, document: DiagramDocument, local: ProjectViewLocal | null): void;
    /* Takes the diagram off screen without saving; the client flushes before it calls this. */
    unload(): void;
    exportContent(): DiagramContent;
    /* A change a person made, as a whole new content; the handles below are the ones the view offers. */
    replaceContent(content: DiagramContent): void;
    /* `first` says this is the first step of a drag, which is the one that goes into the history. */
    moveNode(id: string, pos: [number, number], first: boolean): void;
    renameNode(id: string, label: string): void;
    setNodeTone(id: string, tone: DrawingColor): void;
    /* Gives a dragged node back to the layout. */
    resetPosition(id: string): void;
    undo(): void;
    redo(): void;

    setViewport(viewport: Viewport): void;
    setCamera(camera: Camera): void;
    panBy(dx: number, dy: number): void;
    zoomAt(factor: number, anchor: Point): void;
    settleZoom(anchor: Point): void;
    zoomTo(zoom: number, anchor?: Point): void;
    fitAll(): void;
    /* A diagram has no selection, so the palette's "zoom to selection" fits the whole of it. */
    zoomToSelection(): void;
    viewCamera(): ViewCamera | null;

    setRev(rev: number): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: DiagramDocument | null): void;
    setError(error: string | null): void;
    /* What is on disk now, loaded in place: the camera stays where the person left it. */
    applyDocument(document: DiagramDocument): void;
}

export const contentOf = (document: DiagramDocument): DiagramContent => ({
    meta: document.meta,
    nodes: document.nodes,
    groups: document.groups,
    edges: document.edges
});

const EMPTY_CONTENT = contentOf(EMPTY_DIAGRAM);

export const DIAGRAM_HISTORY_LIMIT = 100;

/* Every change to the content is an edit, laid out again; the client saves on the counter. */
const changed = (state: DiagramState, content: DiagramContent, first = true): Partial<DiagramState> => ({
    content,
    layout: layoutOf(content),
    edits: state.edits + 1,
    ...(first ? { past: [...state.past.slice(-(DIAGRAM_HISTORY_LIMIT - 1)), state.content], future: [] } : {})
});

/* The content with one node rewritten, or null when there is no such node or nothing would change. */
const withNode = (content: DiagramContent, id: string, rewrite: (node: DiagramNode) => DiagramNode): DiagramContent | null => {
    const node = content.nodes.find((candidate) => candidate.id === id);
    if (!node) {
        return null;
    }
    const next = rewrite(node);
    if (next === node) {
        return null;
    }
    return { ...content, nodes: content.nodes.map((candidate) => (candidate.id === id ? next : candidate)) };
};

/*
 * The diagram on screen: the graph, its layout and where the camera is. Shaped after the drawing
 * store, without tools or a selection, because a diagram is written rather than drawn: a person only
 * moves, renames and colors what an agent or the file put there.
 */
export const createDiagramStore = (): StoreApi<DiagramState> =>
    createStore<DiagramState>((set, get) => ({
        viewId: null,
        camera: { x: 0, y: 0, zoom: 1 },
        viewport: { w: 0, h: 0 },
        content: EMPTY_CONTENT,
        layout: layoutOf(EMPTY_CONTENT),
        rev: 0,
        dirty: false,
        edits: 0,
        past: [],
        future: [],
        loading: false,
        pendingCamera: null,
        conflict: null,
        error: null,

        load(viewId, document, local) {
            const content = contentOf(document);
            set({
                loading: true,
                viewId,
                content,
                layout: layoutOf(content),
                rev: document.rev,
                dirty: false,
                edits: 0,
                past: [],
                future: [],
                conflict: null,
                error: null,
                pendingCamera: null
            });
            const stored = local?.camera ?? null;
            if (stored !== null) {
                const camera = cameraOfView(stored, get().viewport);
                set(camera === null ? { pendingCamera: { kind: 'view', view: stored } } : { camera });
            }
            set({ loading: false });
            if (stored === null) {
                get().fitAll();
            }
        },

        unload() {
            set({
                viewId: null,
                content: EMPTY_CONTENT,
                layout: layoutOf(EMPTY_CONTENT),
                rev: 0,
                dirty: false,
                edits: 0,
                past: [],
                future: [],
                conflict: null,
                error: null
            });
        },

        exportContent() {
            return get().content;
        },

        replaceContent(content) {
            set((state) => changed(state, content));
        },
        moveNode(id, [x, y], first) {
            const state = get();
            const pos: [number, number] = [Math.round(x), Math.round(y)];
            const content = withNode(state.content, id, (node) => (node.pos?.[0] === pos[0] && node.pos[1] === pos[1] ? node : { ...node, pos }));
            if (content !== null) {
                set(changed(state, content, first));
            }
        },
        renameNode(id, label) {
            const state = get();
            // An empty label would leave a box nobody can find again, so it keeps the one it had.
            const next = label.trim();
            const content = withNode(state.content, id, (node) => (next === '' || next === node.label ? node : { ...node, label: next }));
            if (content !== null) {
                set(changed(state, content));
            }
        },
        setNodeTone(id, tone) {
            const state = get();
            const content = withNode(state.content, id, (node) => (node.tone === tone ? node : { ...node, tone }));
            if (content !== null) {
                set(changed(state, content));
            }
        },
        resetPosition(id) {
            const state = get();
            const content = withNode(state.content, id, (node) => {
                if (!node.pos) {
                    return node;
                }
                const rest = { ...node };
                delete rest.pos;
                return rest;
            });
            if (content !== null) {
                set(changed(state, content));
            }
        },
        undo() {
            const state = get();
            const previous = state.past.at(-1);
            if (!previous) {
                return;
            }
            set({
                content: previous,
                layout: layoutOf(previous),
                past: state.past.slice(0, -1),
                future: [state.content, ...state.future],
                edits: state.edits + 1
            });
        },
        redo() {
            const state = get();
            const next = state.future[0];
            if (!next) {
                return;
            }
            set({ content: next, layout: layoutOf(next), past: [...state.past, state.content], future: state.future.slice(1), edits: state.edits + 1 });
        },

        setViewport(viewport) {
            const waiting = isMeasured(viewport) ? get().pendingCamera : null;
            set({ viewport });
            if (waiting?.kind === 'fit') {
                get().fitAll();
            } else if (waiting?.kind === 'view') {
                set({ camera: cameraOfView(waiting.view, viewport)!, pendingCamera: null });
            }
        },
        setCamera(camera) {
            set({ camera });
        },
        panBy(dx, dy) {
            const { camera } = get();
            set({ camera: { ...camera, x: camera.x + dx, y: camera.y + dy } });
        },
        zoomAt(factor, anchor) {
            const { camera } = get();
            set({ camera: zoomAround(camera, camera.zoom * factor, anchor) });
        },
        settleZoom(anchor) {
            const { camera } = get();
            const target = snapZoom(camera.zoom);
            if (target !== camera.zoom) {
                set({ camera: zoomAround(camera, target, anchor) });
            }
        },
        zoomTo(zoom, anchor) {
            const { camera, viewport } = get();
            set({ camera: zoomAround(camera, clampZoom(zoom), anchor ?? { x: viewport.w / 2, y: viewport.h / 2 }) });
        },
        fitAll() {
            const { layout, viewport } = get();
            // An empty diagram has nothing to fit, so the wait ends rather than standing forever.
            if (layout.nodes.length === 0) {
                set({ pendingCamera: null });
                return;
            }
            const camera = cameraToFit(layout.bounds, viewport);
            set(camera === null ? { pendingCamera: { kind: 'fit' } } : { camera, pendingCamera: null });
        },
        zoomToSelection() {
            get().fitAll();
        },
        viewCamera() {
            const { camera, viewport, pendingCamera } = get();
            return pendingCamera?.kind === 'view' ? pendingCamera.view : viewCameraOf(camera, viewport);
        },

        setRev(rev) {
            set({ rev });
        },
        setDirty(dirty) {
            set({ dirty });
        },
        setConflict(conflict) {
            set({ conflict });
        },
        setError(error) {
            set({ error });
        },
        applyDocument(document) {
            const content = contentOf(document);
            // What is on disk now is another starting point, so the steps back from the old one are gone.
            set({ loading: true, content, layout: layoutOf(content), rev: document.rev, dirty: false, conflict: null, past: [], future: [] });
            set({ loading: false });
        }
    }));

export const defaultDiagramStore = createDiagramStore();

/* The registry of no workspace at all; its blank editor is the store this module made. */
export const defaultDiagrams = createEditorRegistry(createDiagramStore, defaultDiagramStore);

/* What a component reads while it renders: the diagram of the cell it is drawn in. */
export const useDiagram = editorHook('diagrams', defaultDiagrams);

/* The diagram store of the cell a component is drawn in, for everything that writes or subscribes. */
export const useDiagramStore = (): StoreApi<DiagramState> => useEditorStoreOf('diagrams', defaultDiagrams);

/* The diagram of the cell that has the focus, for a palette row with no cell of its own. */
export const focusedDiagram = (): StoreApi<DiagramState> => focusedEditor('diagrams', defaultDiagrams);

/* The diagram editors of the workspace in front of us, which outside one is the default registry. */
const diagrams = (): EditorRegistry<DiagramState> => currentStores()?.diagrams ?? defaultDiagrams;

/* What a diagram view holds right now, which is fresher than anything the daemon has been told. */
export const liveDiagram = (viewId: string): DiagramState | null => diagrams().peek(viewId)?.getState() ?? null;

/* Every change in every diagram on screen, named by the view it happened in; rewired when the focus moves to another workspace. */
export const subscribeDiagrams = (listener: (viewId: string, state: DiagramState, previous: DiagramState) => void): (() => void) => {
    let off = diagrams().subscribe(listener);
    const offWorkspaces = subscribeCurrentWorkspace(() => {
        off();
        off = diagrams().subscribe(listener);
    });
    return () => {
        off();
        offWorkspaces();
    };
};
