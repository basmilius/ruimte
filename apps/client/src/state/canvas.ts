import { createStore, type StoreApi } from 'zustand';
import type { ProjectCanvasLine, ProjectCanvasView, ProjectLayout, ProjectViewLocal, NodeAccent, NodeKind, NodeTitleSource } from '@ruimte/contracts';
import { DEFAULT_TITLES, NODE_SIZE, isAgentKind } from '@ruimte/contracts';
import { textRect } from '@/canvas/edge-lines';
import { isMeasured, unionOf, type Point, type Rect } from '@/canvas/math';
import type { NodeDirection } from '@/canvas/node-navigation';
import type { DerivedFrame } from '@/canvas/node-body';
import { createCameraSlice, type CameraSlice } from '@/canvas/camera-slice';
import type { ArrangeRefusal } from '@/canvas/arrange-group';
import type { CanvasPatch } from '@/project/merge';
import { editorBindings } from '@/state/editor-bindings';
import { createEditorRegistry } from '@/state/editors';
import { withCameraHistory } from '@/state/canvas-camera-history';
import { createCanvasContentSlice } from '@/state/canvas-content-slice';
import { createCanvasEdgesSlice } from '@/state/canvas-edges-slice';
import { createCanvasGestureSlice } from '@/state/canvas-gesture-slice';
import { createCanvasLayoutsSlice } from '@/state/canvas-layouts-slice';
import {
    boundsOfElement,
    maximizedNodeOf,
    type AddNodeOptions,
    type CanvasNode,
    type Edge,
    type EdgeSides,
    type GapMove,
    type LinkDraft,
    type Locks,
    type Snapshot,
    type TextElement
} from '@/state/canvas-model';
import { createCanvasNavigationSlice } from '@/state/canvas-navigation-slice';
import { createCanvasNodesSlice } from '@/state/canvas-nodes-slice';
import { createCanvasSelectionSlice } from '@/state/canvas-selection-slice';
import { createCanvasTextsSlice } from '@/state/canvas-texts-slice';
import { createCanvasLinesSlice } from '@/state/canvas-lines-slice';
import { lineBounds } from '@/canvas/line-geometry';

export type { AgentStatus, NodeKind } from '@ruimte/contracts';
export type { CameraRequest, Viewport } from '@/canvas/camera-slice';
export { setCameraClock } from '@/state/canvas-camera-history';
export {
    carriedByGroups,
    GROUP_HEADER_PX,
    maximizedNodeOf,
    membersOf,
    nextId,
    patchSnapshot,
    zoomNodeTargetOf,
    type AddNodeOptions,
    type CanvasNode,
    type Edge,
    type EdgeSides,
    type Locks,
    type Snapshot,
    type TextElement
} from '@/state/canvas-model';

export interface CanvasState extends CameraSlice {
    /*
     * The view whose content this store holds. The document store flips `activeViewId` before it hands
     * the canvas the next view, so anything asking which nodes a view has pairs on this instead.
     */
    viewId: string | null;
    nodes: Record<string, CanvasNode>;
    order: string[];
    texts: Record<string, TextElement>;
    lines: Record<string, ProjectCanvasLine>;
    linesPresent: boolean;
    lineTool: 'line' | null;
    setLineTool(tool: 'line' | null): void;
    addLine(line: Omit<ProjectCanvasLine, 'id'>): string | null;
    updateLine(id: string, patch: Partial<Omit<ProjectCanvasLine, 'id'>>, undoable?: boolean): void;
    duplicateLine(id: string): void;
    edges: Edge[];
    layouts: ProjectLayout[];
    linkDraft: LinkDraft | null;
    /* Node ids inside a collapsed group; they keep running, they are just not drawn. */
    hidden: Set<string>;
    selection: string[];
    navigationId: string | null;
    /*
     * The node whose content has the keyboard. It is not a second selection: a node is selected to be
     * moved, resized or removed, and it has the focus to be typed in. Dragging one never gives it the
     * focus, and a node keeps it while it is dragged by its own header.
     */
    bodyFocusId: string | null;
    /* The node drawn over the whole canvas at actual size. Where it stands and how big it is stay as they were. */
    maximizedId: string | null;
    editingTextId: string | null;
    locks: Locks;
    /* Node currently under a resize handle, so it can show its size, or the id of a resizable card. Transient. */
    resizing: string | null;
    /*
     * The cards drawn beside a node, by an id no node has. Transient. One is a stop when moving with the
     * keys: it is then `navigationId` with nothing selected, since nothing moves or removes it, and a
     * press or Enter in it hands its owner the keyboard while it stays `navigationId`.
     */
    derivedCards: Record<string, DerivedFrame>;
    /* A pointer gesture is running, so nothing else may take the pointer. */
    gesturing: boolean;
    panning: boolean;
    gapMove: GapMove | null;
    /* True for the one update that swaps in another project's content, so nobody reads it as edits. */
    loading: boolean;
    /*
     * True for the one update that takes in another writer's change. Like `loading` it is no edit, but
     * a node it removes is really gone from the file, so what this client held for it can go too.
     */
    merging: boolean;
    past: Snapshot[];
    future: Snapshot[];

    /* Brings the camera to one node and selects it. */
    goToNode(id: string): void;
    zoomToNode(id?: string): void;
    /* One step back (-1) or forward (1) through the places this view's camera was; false where there is none. */
    stepCamera(direction: -1 | 1): boolean;
    selectNeighbor(direction: NodeDirection): void;
    beginGapMove(ids: string[], fixed?: string[]): boolean;
    moveGapNodes(offsets: Record<string, Point>): void;
    endGapMove(cancel?: boolean): void;

    /* `additive` is shift: what is already selected stays, and something clicked again drops out. */
    select(ids: string[], additive?: boolean): void;
    clearSelection(): void;
    /* A box only ever adds, since dragging one across what is selected must not clear it. */
    selectInRect(rect: Rect, additive?: boolean): void;
    /* Puts a node on top, selects it and hands its content the keyboard: what a click in a body does. */
    activateNode(id: string): void;
    setBodyFocus(id: string | null): void;
    /* Maximizing hands the node the keyboard as well, since it is all there is to type in. */
    toggleMaximizedNode(id: string): void;

    /* `first` marks the first step of a drag, the moment worth remembering for undo. */
    moveSelected(dx: number, dy: number, first?: boolean): void;
    settleMove(): void;
    resizeNode(id: string, rect: Rect): void;
    setResizing(id: string | null): void;
    setDerivedCard(id: string, card: DerivedFrame | null): void;
    /* What a press in a card does: its owner's content has the keyboard, and the card is where the keys go on from. */
    focusCard(id: string): void;
    setGesturing(gesturing: boolean): void;
    setPanning(panning: boolean): void;
    bringToFront(id: string): void;
    /* One of the accents or none; a note takes its paper from it. One undo step. */
    setNodeColor(id: string, accent: NodeAccent | null): void;
    /* A rename is a person's unless the session that named itself says otherwise. A null source
       unnames the node, so its own source may name it again. */
    renameNode(id: string, title: string, source?: NodeTitleSource | null): void;
    /* Changes what a node carries (its page, its folder) without touching its placement. */
    updateNode(
        id: string,
        patch: Partial<Pick<CanvasNode, 'url' | 'cwd' | 'command' | 'resume' | 'body' | 'provider' | 'artifact' | 'chats'>>,
        undoable?: boolean
    ): void;
    duplicateNode(id: string): void;
    /* Null with no view under the canvas, since nothing in the project file could hold such a node. */
    addNode(kind: NodeKind, at: Point, options?: AddNodeOptions): string | null;
    /* Wraps the selected nodes in a group; answers null when nothing is selected. */
    groupSelection(): string | null;
    /* Tidies the members that stand directly in a group into a grid, as one undo step; the ids of what moved, or why not. */
    arrangeGroup(id: string): { moved: string[] } | { refused: ArrangeRefusal };
    addText(at: Point): string;
    updateText(id: string, text: string): void;
    styleText(
        id: string,
        patch: Partial<Pick<TextElement, 'font' | 'bold' | 'italic' | 'size' | 'underline' | 'strikethrough' | 'align' | 'maxWidth' | 'color'>>,
        undoable?: boolean
    ): void;
    resizeText(id: string, x: number, maxWidth: number, undoable?: boolean): void;
    setEditingText(id: string | null): void;
    deleteSelected(): void;
    toggleLock(key: keyof Locks): void;

    /* Folds a node to its header and opens it again, one undo step. A group hides what it holds as well. */
    toggleCollapse(id: string): void;
    setGroupWorktree(id: string, worktree: { path: string; branch: string } | null): void;
    /*
     * Edges: nodes connect to other nodes. Into an agent node (terminal or chat) the edge also makes
     * the source readable, so between two agents this draws both ways at once and answers with the id
     * of the one that was asked for.
     */
    addEdge(from: string, to: string, sides?: EdgeSides): string | null;
    removeEdge(id: string): void;
    setEdgeLabel(id: string, label: string): void;
    setLinkDraft(draft: LinkDraft | null): void;
    /* "Connect to…" from a menu: the line follows the pointer until a click lands on a target. */
    startLink(from: string): void;
    saveLayout(name: string): void;
    /* A layout as it was, for an undo that brings back what a save replaced or a delete took. */
    putLayout(layout: ProjectLayout): void;
    applyLayout(name: string): void;
    deleteLayout(name: string): void;

    /* Replaces the canvas with one view of the project; the camera comes from the machine-local state. */
    loadView(view: ProjectCanvasView | null, local: ProjectViewLocal | null): void;
    /*
     * What another writer (an agent or a second client) changed on this canvas, put in beside what
     * the person is doing: no history step and no camera move, so a drag in progress and an undo
     * stack both survive it. What it adds or deletes goes into every step of that stack as well
     * (`patchSnapshot`). Only what was deleted leaves the selection.
     */
    applyExternal(patch: CanvasPatch): void;
    /* The nodes a gesture is moving or resizing right now, which a merge leaves where the person has them. */
    heldNodeIds(): string[];
    exportContent(): Pick<ProjectCanvasView, 'nodes' | 'texts' | 'edges' | 'layouts' | 'lines'>;
    undo(): void;
    redo(): void;
}

export { DEFAULT_TITLES, NODE_SIZE, isAgentKind };

/* One canvas editor, for one view on screen. */
export function createCanvasStore(): StoreApi<CanvasState> {
    return createStore<CanvasState>((set, get) => {
        const slice = createCameraSlice<CanvasState>(set, get, {
            // The cards beside a node too, or fitting leaves the open page of a design half off screen.
            boundsOfAll: (state) =>
                unionOf([
                    ...Object.values(state.nodes),
                    ...Object.values(state.texts).map(textRect),
                    ...Object.values(state.lines).map(lineBounds),
                    ...Object.values(state.derivedCards).map((card) => card.rect)
                ]),
            boundsOfSelection: (state) => unionOf(state.selection.flatMap((id) => boundsOfElement(id, state.nodes, state.texts, state.lines))),
            resume: (state, request) => {
                if (request.kind === 'node') {
                    state.goToNode(request.id);
                }
            }
        });

        const base: Omit<CanvasState, 'stepCamera'> = {
            ...slice,

            viewId: null,
            nodes: {},
            order: [],
            texts: {},
            lines: {},
            linesPresent: false,
            lineTool: null,
            edges: [],
            layouts: [],
            linkDraft: null,
            hidden: new Set(),
            selection: [],
            navigationId: null,
            bodyFocusId: null,
            maximizedId: null,
            editingTextId: null,
            locks: { pan: false, zoom: false, move: false, resize: false },
            resizing: null,
            derivedCards: {},
            gesturing: false,
            panning: false,
            gapMove: null,
            loading: false,
            merging: false,
            past: [],
            future: [],

            ...createCanvasNavigationSlice(set, get),
            ...createCanvasSelectionSlice(set, get),
            ...createCanvasGestureSlice(set, get),
            ...createCanvasNodesSlice(set, get),
            ...createCanvasTextsSlice(set),
            ...createCanvasLinesSlice(set, get),
            ...createCanvasEdgesSlice(set, get),
            ...createCanvasLayoutsSlice(set, get),
            ...createCanvasContentSlice(set, get)
        };

        return withCameraHistory(base, set, get);
    });
}

/* The blank canvas of the window: what a view that is not a canvas reads, and what a unit test reads. */
export const defaultCanvasStore = createCanvasStore();

/* The canvas editors of the window; its blank editor is the store this module made. */
export const defaultCanvases = createEditorRegistry(createCanvasStore, defaultCanvasStore);

/*
 * `focusedCanvas` is the canvas a shortcut, a window menu or a palette row means. Inside a cell it is
 * the wrong store as often as not.
 */
export const {
    use: useCanvas,
    useStore: useCanvasStore,
    focused: focusedCanvas,
    live: liveCanvas,
    subscribe: subscribeCanvases
} = editorBindings(defaultCanvases);

/*
 * The editor of the view a node stands on, out of every canvas on screen. What arrives for one node
 * (a title from its CLI, a close, a page's url) is about that node's own view, which in a split is
 * not always the one with the focus.
 */
export function canvasOfNode(nodeId: string): StoreApi<CanvasState> | null {
    return defaultCanvases.live().find(([, store]) => store.getState().nodes[nodeId] !== undefined)?.[1] ?? null;
}

/*
 * Selects a node and brings the camera to it once it is on its canvas, for a node the machine writes
 * (a fork) and that arrives with the next `project.changed`. Nothing happens for a canvas not on screen.
 * Answers how to stop waiting, for a caller that learns the node will never come.
 */
export function revealWhenItLands(viewId: string, nodeId: string, onLanded?: () => void): () => void {
    const store = defaultCanvases.peek(viewId);
    if (!store) {
        return () => {};
    }
    if (store.getState().nodes[nodeId] !== undefined) {
        store.getState().goToNode(nodeId);
        onLanded?.();
        return () => {};
    }
    const off = store.subscribe((state) => {
        if (state.nodes[nodeId] !== undefined) {
            // Before the move, which is a change this listener would otherwise hear again.
            off();
            state.goToNode(nodeId);
            onLanded?.();
        }
    });
    return off;
}

/*
 * Resolves once the canvas of a view just put on screen has its nodes, its size and its camera, since a
 * node placed in free space before then lands in the corner of an editor one frame old. False when the
 * canvas left the screen first.
 */
export function canvasSettled(viewId: string): Promise<boolean> {
    const settled = (state: CanvasState): boolean => !state.loading && isMeasured(state.viewport) && state.pendingCamera === null;
    return new Promise((resolve) => {
        let seen = false;
        const offs: (() => void)[] = [];
        const check = (): void => {
            const store = defaultCanvases.peek(viewId);
            seen ||= store !== null;
            const done = store !== null && settled(store.getState());
            if (done || (seen && store === null)) {
                for (const off of offs) {
                    off();
                }
                resolve(done);
            }
        };
        offs.push(defaultCanvases.subscribe(check), defaultCanvases.subscribeShape(check));
        check();
    });
}

/* Every canvas on screen, which is what a watcher about the whole project walks over. */
export function liveCanvases(): [string, CanvasState][] {
    return defaultCanvases.live().map(([viewId, store]) => [viewId, store.getState()]);
}

/*
 * The node the maximize shortcut acts on: the maximized one, else the one with the keyboard, else the
 * one selected alone. A group has no content to fill the canvas with. Null leaves the key to the grid.
 */
export function maximizeTargetOf(s: Pick<CanvasState, 'maximizedId' | 'nodes' | 'hidden' | 'bodyFocusId' | 'selection'>): string | null {
    const maximized = maximizedNodeOf(s);
    if (maximized !== null) {
        return maximized;
    }
    const id = s.bodyFocusId ?? (s.selection.length === 1 ? s.selection[0]! : null);
    const node = id === null ? undefined : s.nodes[id];
    return node !== undefined && node.kind !== 'group' && !s.hidden.has(node.id) ? node.id : null;
}

/* A node's content has the keyboard, which is what a page, a terminal and the wheel all read. */
export function isNodeActive(bodyFocusId: string | null, id: string): boolean {
    return bodyFocusId === id;
}
