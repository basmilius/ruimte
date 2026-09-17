import { createStore, type StoreApi } from 'zustand';
import { createEditorRegistry } from '@/state/editors';
import { editorHook, focusedEditor, useEditorStoreOf } from '@/state/workspace-stores';
import {
    cameraCenteredOn,
    cameraOfView,
    cameraToFit,
    clampZoom,
    intersects,
    isMeasured,
    snapToGrid,
    snapZoom,
    unionRect,
    viewCameraOf,
    zoomAround,
    type Camera,
    type Point,
    type Rect
} from '@/canvas/math';

import type { CanvasPatch } from '@/project/merge';
import type {
    AgentKind,
    AgentStatus,
    NodeKind,
    NodeTitleSource,
    ProjectCanvasView,
    ProjectLayout,
    ProjectNode,
    ProjectViewLocal,
    RuntimeMode,
    ViewCamera
} from '@ruimte/contracts';
import { DEFAULT_TITLES, NODE_SIZE, groupFrame, isAgentKind, isUnknownNode } from '@ruimte/contracts';

export type { AgentStatus, NodeKind } from '@ruimte/contracts';

/* A node as stored in the project file, plus a status for kinds without a daemon-side one (browser). */
export interface CanvasNode extends ProjectNode {
    status?: AgentStatus;
}

export interface AddNodeOptions {
    title?: string;
    /* Browsers only: the page it opens on, instead of the default address. */
    url?: string;
    cwd?: string;
    command?: string;
    resume?: string;
    provider?: AgentKind;
    /* Chats only: the CLI came from a menu, so the composer offers no other one. */
    providerFixed?: boolean;
    // Terminal agents only: the permission mode the CLI starts in.
    runtimeMode?: RuntimeMode;
    // Drawings only: the drawing view this node mirrors.
    viewId?: string;
    // Files only: the file it reads, relative to the project folder or absolute outside it.
    path?: string;
}

export interface TextElement extends Point {
    id: string;
    text: string;
    size: number;
}

export interface Edge {
    id: string;
    from: string;
    to: string;
    label?: string;
}

/*
 * An edge being drawn: from a node or text to wherever the pointer is, in world units. Started from
 * a port it lives as long as the drag; started from a menu (`aiming`) it waits for a click on a target.
 */
interface LinkDraft {
    from: string;
    to: Point;
    aiming?: boolean;
}

// The height of a node frame's header; a collapsed group is its header only.
export const GROUP_HEADER_PX = 39;

/* Which gestures the canvas refuses. Commands (dock buttons, shortcuts) always work. */
export interface Locks {
    pan: boolean;
    zoom: boolean;
    move: boolean;
    resize: boolean;
}

type Mode = { kind: 'canvas' } | { kind: 'node'; nodeId: string };

/* What undo and redo restore: the placement of everything, never the camera or the selection. */
interface Snapshot {
    nodes: Record<string, CanvasNode>;
    order: string[];
    texts: Record<string, TextElement>;
    edges: Edge[];
    layouts: ProjectLayout[];
}

const HISTORY_LIMIT = 100;

interface Viewport {
    w: number;
    h: number;
}

/* A camera move that needs a size to be worked out: everything the canvas has, one node of it, or a stored middle. */
export type CameraRequest = { kind: 'fit' } | { kind: 'node'; id: string } | { kind: 'view'; view: ViewCamera };

export interface CanvasState {
    /*
     * The view whose content this store is holding. The document store flips `activeViewId` before
     * it hands the canvas the next view, so pairing on that id makes the canvas stand in for a view
     * it does not hold yet; anything asking which nodes the project has must pair on this instead.
     */
    viewId: string | null;
    camera: Camera;
    viewport: Viewport;
    /*
     * Where the camera has to go the moment this editor has a size. Every view on screen has an
     * editor of its own, made when the view goes into a cell, and the element that holds it is
     * measured a frame later: a fit or a jump to a node asked for in between has no viewport to be
     * about. It waits here instead of being worked out against nothing, which would park the camera
     * at the origin and leave what it was aimed at in the top left corner.
     */
    pendingCamera: CameraRequest | null;
    nodes: Record<string, CanvasNode>;
    order: string[];
    texts: Record<string, TextElement>;
    edges: Edge[];
    layouts: ProjectLayout[];
    linkDraft: LinkDraft | null;
    /* Node ids inside a collapsed group; they keep running, they are just not drawn. */
    hidden: Set<string>;
    selection: string[];
    mode: Mode;
    editingTextId: string | null;
    locks: Locks;
    /* Node currently under a resize handle, so it can show its size. Transient. */
    resizing: string | null;
    /* A pointer gesture is running (pan, box, move, resize, link), so nothing else may take the pointer. */
    gesturing: boolean;
    /* True for the one update that swaps in another project's content, so nobody reads it as edits. */
    loading: boolean;
    past: Snapshot[];
    future: Snapshot[];

    setViewport(viewport: Viewport): void;
    setCamera(camera: Camera): void;
    panBy(dx: number, dy: number): void;
    zoomAt(factor: number, anchor: Point): void;
    settleZoom(anchor: Point): void;
    zoomTo(zoom: number, anchor?: Point): void;
    fitAll(): void;
    zoomToSelection(): void;
    goToNode(id: string): void;
    /* The camera the way it is stored. An editor still waiting for its size hands back the one it was given. */
    viewCamera(): ViewCamera | null;

    select(ids: string[], additive?: boolean): void;
    clearSelection(): void;
    selectInRect(rect: Rect): void;
    enterNode(id: string): void;
    exitNode(): void;

    /* `first` marks the first step of a drag, the moment worth remembering for undo. */
    moveSelected(dx: number, dy: number, first?: boolean): void;
    settleMove(): void;
    resizeNode(id: string, rect: Rect): void;
    setResizing(id: string | null): void;
    setGesturing(gesturing: boolean): void;
    bringToFront(id: string): void;
    setNodeAccent(id: string, accent: string | null): void;
    /* A rename is a person's unless the session that named itself says otherwise. */
    /* A null source unnames the node: nothing named it, so its own source may name it again. */
    renameNode(id: string, title: string, source?: NodeTitleSource | null): void;
    /* Changes what a node carries (its page, its folder) without touching its placement. */
    updateNode(id: string, patch: Partial<Pick<CanvasNode, 'url' | 'cwd' | 'command' | 'resume' | 'body' | 'color' | 'provider'>>): void;
    duplicateNode(id: string): void;
    /* Null with no view under the canvas: nothing in the project file could hold such a node. */
    addNode(kind: NodeKind, at: Point, options?: AddNodeOptions): string | null;
    /* Wraps the selected nodes in a group; answers null when nothing is selected. */
    groupSelection(): string | null;
    addText(at: Point): string;
    updateText(id: string, text: string): void;
    setEditingText(id: string | null): void;
    deleteSelected(): void;
    toggleLock(key: keyof Locks): void;
    setAllLocks(locked: boolean): void;

    toggleGroupCollapse(id: string): void;
    setGroupWorktree(id: string, worktree: { path: string; branch: string } | null): void;
    /* Edges: any node or text to any other. Into an agent node (terminal or chat) the edge also makes the source readable. */
    addEdge(from: string, to: string): string | null;
    removeEdge(id: string): void;
    setEdgeLabel(id: string, label: string): void;
    setLinkDraft(draft: LinkDraft | null): void;
    /* "Connect to..." from a menu: the line follows the pointer until a click lands on a target. */
    startLink(from: string): void;
    saveLayout(name: string): void;
    applyLayout(name: string): void;
    deleteLayout(name: string): void;

    /* Replaces the canvas with one view of the project; the camera comes from the machine-local state. */
    loadView(view: ProjectCanvasView | null, local: ProjectViewLocal | null): void;
    /*
     * What another writer (an agent or a second client) changed on this canvas, put in beside what
     * the person is doing: no history step and no camera move, so a drag in progress and an undo
     * stack both survive it. Only what was deleted leaves the selection.
     */
    applyExternal(patch: CanvasPatch): void;
    /* The nodes a gesture is moving or resizing right now, which a merge leaves where the person has them. */
    heldNodeIds(): string[];
    exportContent(): Pick<ProjectCanvasView, 'nodes' | 'texts' | 'edges' | 'layouts'>;
    undo(): void;
    redo(): void;
}

export { DEFAULT_TITLES, NODE_SIZE, isAgentKind };

const center = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

const contains = (rect: Rect, point: Point): boolean => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

/* What one group holds: its remembered members when collapsed, else whatever has its center inside the frame. */
export const membersOf = (group: CanvasNode, nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>): string[] => {
    if (group.collapsed) {
        return group.memberIds ?? [];
    }
    const members: string[] = [];
    for (const node of Object.values(nodes)) {
        if (node.id !== group.id && contains(group, center(node))) {
            members.push(node.id);
        }
    }
    for (const text of Object.values(texts)) {
        if (contains(group, text)) {
            members.push(text.id);
        }
    }
    return members;
};

/* A group carries what sits inside it, and a group inside it carries its own members in turn. */
export const carriedByGroups = (nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>, selection: string[]): Set<string> => {
    const carried = new Set<string>();
    const visit = (groupId: string): void => {
        const group = nodes[groupId];
        if (!group || group.kind !== 'group') {
            return;
        }
        for (const id of membersOf(group, nodes, texts)) {
            if (selection.includes(id) || carried.has(id)) {
                continue;
            }
            carried.add(id);
            visit(id);
        }
    };
    for (const id of selection) {
        visit(id);
    }
    return carried;
};

const hiddenIn = (nodes: Record<string, CanvasNode>): Set<string> => {
    const hidden = new Set<string>();
    for (const node of Object.values(nodes)) {
        if (node.kind === 'group' && node.collapsed) {
            for (const id of node.memberIds ?? []) {
                hidden.add(id);
            }
        }
    }
    return hidden;
};

// Ids double as daemon session ids and end up in a shared file, so they must not repeat across machines.
export const nextId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const snapshotOf = (s: Pick<CanvasState, 'nodes' | 'order' | 'texts' | 'edges' | 'layouts'>): Snapshot => ({
    nodes: s.nodes,
    order: s.order,
    texts: s.texts,
    edges: s.edges,
    layouts: s.layouts
});

/* Remembers the placement before a change; called by every action that changes it. */
const remember = (s: CanvasState): Pick<CanvasState, 'past' | 'future'> => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), snapshotOf(s)], future: [] });

/* One canvas editor, for one view on screen. */
export const createCanvasStore = (): StoreApi<CanvasState> =>
    createStore<CanvasState>((set, get) => ({
        viewId: null,
        camera: { x: 0, y: 0, zoom: 1 },
        viewport: { w: 0, h: 0 },
        pendingCamera: null,
        nodes: {},
        order: [],
        texts: {},
        edges: [],
        layouts: [],
        linkDraft: null,
        hidden: new Set(),
        selection: [],
        mode: { kind: 'canvas' },
        editingTextId: null,
        locks: { pan: false, zoom: false, move: false, resize: false },
        resizing: null,
        gesturing: false,
        loading: false,
        past: [],
        future: [],

        setViewport(viewport) {
            // The size is the answer to whatever was waiting for one, so the wait ends here.
            const waiting = isMeasured(viewport) ? get().pendingCamera : null;
            set({ viewport });
            if (waiting?.kind === 'fit') {
                get().fitAll();
            } else if (waiting?.kind === 'node') {
                get().goToNode(waiting.id);
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
            const point = anchor ?? { x: viewport.w / 2, y: viewport.h / 2 };
            set({ camera: zoomAround(camera, clampZoom(zoom), point) });
        },
        fitAll() {
            const { nodes, texts, viewport } = get();
            const rects: Rect[] = [...Object.values(nodes), ...Object.values(texts).map((t) => ({ x: t.x, y: t.y, w: t.size * 12, h: t.size * 1.4 }))];
            const bounds = unionRect(rects);
            // An empty canvas has nothing to fit, so the wait ends rather than standing forever.
            if (!bounds) {
                set({ pendingCamera: null });
                return;
            }
            const camera = cameraToFit(bounds, viewport);
            set(camera === null ? { pendingCamera: { kind: 'fit' } } : { camera, pendingCamera: null });
        },
        zoomToSelection() {
            const { nodes, texts, selection, viewport } = get();
            const rects: Rect[] = selection.flatMap((id) => {
                if (nodes[id]) {
                    return [nodes[id]];
                }
                const t = texts[id];
                return t ? [{ x: t.x, y: t.y, w: t.size * 12, h: t.size * 1.4 }] : [];
            });
            const bounds = unionRect(rects);
            const camera = bounds === null ? null : cameraToFit(bounds, viewport, 96, 1.5);
            // A shortcut on a canvas nobody can see yet is worth nothing later, so this one does not wait.
            if (camera !== null) {
                set({ camera, pendingCamera: null });
            }
        },
        goToNode(id) {
            const { nodes, viewport, camera } = get();
            const node = nodes[id];
            if (!node) {
                return;
            }
            const next = cameraCenteredOn(node, viewport, Math.max(camera.zoom, 0.75));
            /* Revealing a node on another view switches to it first, which makes the editor this
               runs on one frame old: it waits for the size rather than landing in the corner. */
            set({
                ...(next === null ? { pendingCamera: { kind: 'node', id } } : { camera: next, pendingCamera: null }),
                selection: [id],
                mode: { kind: 'canvas' }
            });
        },
        viewCamera() {
            const { camera, viewport, pendingCamera } = get();
            return pendingCamera?.kind === 'view' ? pendingCamera.view : viewCameraOf(camera, viewport);
        },

        select(ids, additive = false) {
            const current = get().selection;
            set({ selection: additive ? Array.from(new Set([...current, ...ids])) : ids });
        },
        clearSelection() {
            set({ selection: [] });
        },
        selectInRect(rect) {
            const { nodes, texts } = get();
            const hits = [
                ...Object.values(nodes)
                    .filter((n) => intersects(n, rect))
                    .map((n) => n.id),
                ...Object.values(texts)
                    .filter((t) => intersects({ x: t.x, y: t.y, w: t.size * 8, h: t.size * 1.4 }, rect))
                    .map((t) => t.id)
            ];
            set({ selection: hits });
        },
        enterNode(id) {
            get().bringToFront(id);
            set({ mode: { kind: 'node', nodeId: id }, selection: [id], editingTextId: null });
        },
        exitNode() {
            set({ mode: { kind: 'canvas' } });
        },

        moveSelected(dx, dy, first = false) {
            const s = get();
            const { nodes, texts, selection, locks } = s;
            if (locks.move) {
                return;
            }
            const nextNodes = { ...nodes };
            const nextTexts = { ...texts };
            for (const id of [...selection, ...carriedByGroups(nodes, texts, selection)]) {
                if (nextNodes[id]) {
                    nextNodes[id] = { ...nextNodes[id], x: nextNodes[id].x + dx, y: nextNodes[id].y + dy };
                } else if (nextTexts[id]) {
                    nextTexts[id] = { ...nextTexts[id], x: nextTexts[id].x + dx, y: nextTexts[id].y + dy };
                }
            }
            set({ nodes: nextNodes, texts: nextTexts, ...(first ? remember(s) : {}) });
        },
        settleMove() {
            const { nodes, texts, selection } = get();
            const nextNodes = { ...nodes };
            const nextTexts = { ...texts };
            for (const id of [...selection, ...carriedByGroups(nodes, texts, selection)]) {
                if (nextNodes[id]) {
                    nextNodes[id] = { ...nextNodes[id], x: snapToGrid(nextNodes[id].x), y: snapToGrid(nextNodes[id].y) };
                } else if (nextTexts[id]) {
                    nextTexts[id] = { ...nextTexts[id], x: snapToGrid(nextTexts[id].x), y: snapToGrid(nextTexts[id].y) };
                }
            }
            set({ nodes: nextNodes, texts: nextTexts });
        },
        resizeNode(id, rect) {
            const { nodes, locks } = get();
            if (locks.resize || !nodes[id]) {
                return;
            }
            set({ nodes: { ...nodes, [id]: { ...nodes[id], ...rect } } });
        },
        setResizing(id) {
            // The handle goes down before the first resize, so this is where the old size is remembered.
            set((s) => (id !== null && s.resizing === null ? { resizing: id, ...remember(s) } : { resizing: id }));
        },
        setGesturing(gesturing) {
            set({ gesturing });
        },
        /* A node of an unknown kind is written back as it was read, apart from its frame, so an accent,
           a title or a patch on it would be an edit that never reaches the file. */
        setNodeAccent(id, accent) {
            set((s) => (s.nodes[id] && !isUnknownNode(s.nodes[id]) ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], accent: accent ?? undefined } } } : {}));
        },
        renameNode(id, title, source = 'user') {
            set((s) => {
                const node = s.nodes[id];
                // A rename that changes nothing claims nothing: the editor closes on a blur either way.
                if (!node || isUnknownNode(node) || (node.title === title && (node.titleSource ?? null) === source)) {
                    return {};
                }
                return { nodes: { ...s.nodes, [id]: { ...node, title, titleSource: source ?? undefined } } };
            });
        },
        updateNode(id, patch) {
            set((s) => (s.nodes[id] && !isUnknownNode(s.nodes[id]) ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } } } : {}));
        },
        duplicateNode(id) {
            const source = get().nodes[id];
            // What a newer Ruimte's node holds may be tied to its id (a session, a file), so a copy of it is not this version's to make.
            if (!source || isUnknownNode(source)) {
                return;
            }
            const copyId = nextId(source.kind);
            // A copy is a new node: a fresh session, never the original's agent session.
            const copy: CanvasNode = { ...source, id: copyId, x: source.x + 32, y: source.y + 32, resume: undefined };
            set((s) => ({ nodes: { ...s.nodes, [copyId]: copy }, order: [...s.order, copyId], selection: [copyId], mode: { kind: 'canvas' }, ...remember(s) }));
        },
        bringToFront(id) {
            const { order } = get();
            if (order[order.length - 1] === id) {
                return;
            }
            set({ order: [...order.filter((n) => n !== id), id] });
        },
        addNode(kind, at, options = {}) {
            /* Without a view nothing in the project file is behind the canvas, so a node here would be a live
           terminal or agent that nothing ever saves. The surfaces that offer one are hidden in that
           state; this is the floor under them. */
            if (get().viewId === null && options.viewId === undefined) {
                return null;
            }
            const id = nextId(kind);
            const size = NODE_SIZE[kind];
            // Made inside a group that is bound to a worktree, a node starts in that checkout.
            const host = Object.values(get().nodes)
                .filter((node) => node.kind === 'group' && node.worktree && contains(node, at))
                .sort((a, b) => a.w * a.h - b.w * b.h)[0];
            const node: CanvasNode = {
                id,
                kind,
                title: options.title ?? DEFAULT_TITLES[kind],
                x: snapToGrid(at.x - size.w / 2),
                y: snapToGrid(at.y - size.h / 2),
                ...size,
                url: options.url,
                cwd: options.cwd ?? host?.worktree?.path,
                command: options.command,
                resume: options.resume,
                provider: options.provider,
                providerFixed: options.providerFixed,
                runtimeMode: options.runtimeMode,
                viewId: options.viewId,
                path: options.path
            };
            set((s) => ({ nodes: { ...s.nodes, [id]: node }, order: [...s.order, id], selection: [id], mode: { kind: 'canvas' }, ...remember(s) }));
            return id;
        },
        groupSelection() {
            const { nodes, selection } = get();
            const members = selection.map((id) => nodes[id]).filter((node): node is CanvasNode => Boolean(node) && node!.kind !== 'group');
            // The same frame the daemon's `node group` action draws, so the two ways to group cannot drift.
            const frame = groupFrame(members);
            if (!frame) {
                return null;
            }
            const id = nextId('group');
            const group: CanvasNode = { id, kind: 'group', title: DEFAULT_TITLES.group, ...frame };
            set((s) => ({ nodes: { ...s.nodes, [id]: group }, order: [...s.order, id], selection: [id], mode: { kind: 'canvas' }, ...remember(s) }));
            return id;
        },
        addText(at) {
            const id = nextId('text');
            const text: TextElement = { id, x: snapToGrid(at.x), y: snapToGrid(at.y), text: '', size: 18 };
            set((s) => ({ texts: { ...s.texts, [id]: text }, selection: [id], editingTextId: id, mode: { kind: 'canvas' }, ...remember(s) }));
            return id;
        },
        updateText(id, text) {
            set((s) => (s.texts[id] ? { texts: { ...s.texts, [id]: { ...s.texts[id], text } } } : {}));
        },
        setEditingText(id) {
            set({ editingTextId: id });
        },
        deleteSelected() {
            const { nodes, texts, order, edges, selection } = get();
            if (selection.length === 0) {
                return;
            }
            const gone = new Set(selection);
            // A collapsed group takes what it hid along; nothing should linger unseen.
            for (const id of selection) {
                const node = nodes[id];
                if (node?.kind === 'group' && node.collapsed) {
                    for (const member of node.memberIds ?? []) {
                        gone.add(member);
                    }
                }
            }
            const nextNodes = { ...nodes };
            const nextTexts = { ...texts };
            for (const id of gone) {
                delete nextNodes[id];
                delete nextTexts[id];
            }
            set({
                nodes: nextNodes,
                texts: nextTexts,
                hidden: hiddenIn(nextNodes),
                order: order.filter((id) => !gone.has(id)),
                edges: edges.filter((e) => !gone.has(e.id) && !gone.has(e.from) && !gone.has(e.to)),
                selection: [],
                mode: { kind: 'canvas' },
                ...remember(get())
            });
        },
        toggleLock(key) {
            set((s) => ({ locks: { ...s.locks, [key]: !s.locks[key] } }));
        },
        setAllLocks(locked) {
            set({ locks: { pan: locked, zoom: locked, move: locked, resize: locked } });
        },

        toggleGroupCollapse(id) {
            const s = get();
            const group = s.nodes[id];
            if (!group || group.kind !== 'group') {
                return;
            }
            const next: CanvasNode = group.collapsed
                ? { ...group, collapsed: false, memberIds: undefined, h: group.expandedHeight ?? group.h, expandedHeight: undefined }
                : { ...group, collapsed: true, memberIds: membersOf(group, s.nodes, s.texts), expandedHeight: group.h, h: GROUP_HEADER_PX };
            const nodes = { ...s.nodes, [id]: next };
            const hidden = hiddenIn(nodes);
            set({ nodes, hidden, selection: s.selection.filter((selected) => !hidden.has(selected)), ...remember(s) });
        },
        setGroupWorktree(id, worktree) {
            set((s) => (s.nodes[id]?.kind === 'group' ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], worktree: worktree ?? undefined } } } : {}));
        },
        addEdge(from, to) {
            const s = get();
            const exists = (id: string): boolean => Boolean(s.nodes[id] || s.texts[id]);
            if (from === to || !exists(from) || !exists(to)) {
                return null;
            }
            // One line per pair, whichever way it was drawn.
            if (s.edges.some((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))) {
                return null;
            }
            const id = nextId('edge');
            const target = s.nodes[to];
            // Only a line into an agent carries meaning, so only that one gets a label by default.
            const label = target && isAgentKind(target.kind) ? 'context' : undefined;
            set({ edges: [...s.edges, { id, from, to, label }], linkDraft: null, ...remember(s) });
            return id;
        },
        startLink(from) {
            const s = get();
            const node = s.nodes[from];
            const text = s.texts[from];
            if (!node && !text) {
                return;
            }
            const to = node ? center(node) : { x: text!.x, y: text!.y };
            set({ linkDraft: { from, to, aiming: true }, selection: [from], mode: { kind: 'canvas' } });
        },
        removeEdge(id) {
            set((s) => ({ edges: s.edges.filter((edge) => edge.id !== id), selection: s.selection.filter((selected) => selected !== id), ...remember(s) }));
        },
        setEdgeLabel(id, label) {
            set((s) => ({ edges: s.edges.map((edge) => (edge.id === id ? { ...edge, label: label.trim() || undefined } : edge)) }));
        },
        setLinkDraft(draft) {
            set({ linkDraft: draft });
        },
        saveLayout(name) {
            const s = get();
            const layout: ProjectLayout = {
                name,
                nodes: Object.fromEntries(Object.values(s.nodes).map((node) => [node.id, { x: node.x, y: node.y, w: node.w, h: node.h }])),
                texts: Object.fromEntries(Object.values(s.texts).map((text) => [text.id, { x: text.x, y: text.y }]))
            };
            set({ layouts: [...s.layouts.filter((entry) => entry.name !== name), layout] });
        },
        applyLayout(name) {
            const s = get();
            const layout = s.layouts.find((entry) => entry.name === name);
            if (!layout) {
                return;
            }
            // Nodes the layout never saw stay where they are; nothing is added or removed.
            const nodes = { ...s.nodes };
            for (const [id, rect] of Object.entries(layout.nodes)) {
                if (nodes[id]) {
                    nodes[id] = { ...nodes[id], ...rect };
                }
            }
            const texts = { ...s.texts };
            for (const [id, point] of Object.entries(layout.texts)) {
                if (texts[id]) {
                    texts[id] = { ...texts[id], ...point };
                }
            }
            set({ nodes, texts, ...remember(s) });
        },
        deleteLayout(name) {
            set((s) => ({ layouts: s.layouts.filter((entry) => entry.name !== name) }));
        },

        loadView(view, local) {
            const nodes = view ? Object.fromEntries(view.nodes.map((node) => [node.id, node])) : {};
            const texts = view ? Object.fromEntries(view.texts.map((text) => [text.id, text])) : {};
            set({
                loading: true,
                viewId: view?.id ?? null,
                nodes,
                order: view ? view.nodes.map((node) => node.id) : [],
                texts,
                edges: view?.edges ?? [],
                layouts: view?.layouts ?? [],
                linkDraft: null,
                hidden: hiddenIn(nodes),
                selection: [],
                mode: { kind: 'canvas' },
                editingTextId: null,
                resizing: null,
                past: [],
                future: [],
                pendingCamera: null
            });
            const stored = local?.camera ?? null;
            const camera = stored === null ? null : cameraOfView(stored, get().viewport);
            if (stored !== null) {
                set(camera === null ? { pendingCamera: { kind: 'view', view: stored } } : { camera });
            }
            set({ loading: false });
            // No camera for this view on this machine: it opens on everything it holds, once there is room.
            if (stored === null) {
                get().fitAll();
            }
        },
        applyExternal(patch) {
            // Marked as a load, like a project swapping in: all of it is already on disk, so none of it is an edit.
            set((s) => {
                const gone = new Set([...patch.removed.nodes, ...patch.removed.texts, ...patch.removed.edges]);
                const nodes: Record<string, CanvasNode> = { ...s.nodes };
                for (const id of patch.removed.nodes) {
                    delete nodes[id];
                }
                // Spread over what the editor holds, so what only lives here (a browser's status) stays.
                for (const node of patch.nodes) {
                    const held = nodes[node.id];
                    nodes[node.id] = held ? { ...held, ...node } : node;
                }
                const texts = { ...s.texts };
                for (const id of patch.removed.texts) {
                    delete texts[id];
                }
                for (const text of patch.texts) {
                    const held = texts[text.id];
                    texts[text.id] = held ? { ...held, ...text } : text;
                }
                const arriving = new Map(patch.edges.map((edge) => [edge.id, edge]));
                const edges = s.edges
                    .filter((edge) => !gone.has(edge.id))
                    .map((edge) => (arriving.has(edge.id) ? { ...edge, ...arriving.get(edge.id)! } : edge));
                const present = new Set(edges.map((edge) => edge.id));
                edges.push(...patch.edges.filter((edge) => !present.has(edge.id)));
                const hidden = hiddenIn(nodes);
                const lost = (id: string | null | undefined): boolean => id !== null && id !== undefined && gone.has(id);
                return {
                    loading: true,
                    nodes,
                    order: patch.order.filter((id) => nodes[id] !== undefined),
                    texts,
                    edges,
                    layouts: patch.layouts ?? s.layouts,
                    hidden,
                    ...(gone.size === 0
                        ? {}
                        : {
                              selection: s.selection.filter((id) => !gone.has(id) && !hidden.has(id)),
                              mode: s.mode.kind === 'node' && gone.has(s.mode.nodeId) ? { kind: 'canvas' as const } : s.mode,
                              editingTextId: lost(s.editingTextId) ? null : s.editingTextId,
                              resizing: lost(s.resizing) ? null : s.resizing,
                              linkDraft: lost(s.linkDraft?.from) ? null : s.linkDraft
                          })
                };
            });
            set({ loading: false });
        },
        heldNodeIds() {
            const { gesturing, resizing, selection, nodes, texts } = get();
            if (!gesturing && resizing === null) {
                return [];
            }
            const held = gesturing ? [...selection, ...carriedByGroups(nodes, texts, selection)] : [];
            return resizing === null ? held : [...held, resizing];
        },
        exportContent() {
            const { nodes, order, texts, edges, layouts } = get();
            return {
                nodes: order.map((id) => nodes[id]!).map(({ status: _status, ...node }) => node),
                texts: Object.values(texts),
                edges,
                layouts
            };
        },
        undo() {
            const s = get();
            const previous = s.past[s.past.length - 1];
            if (!previous) {
                return;
            }
            set({
                ...previous,
                hidden: hiddenIn(previous.nodes),
                past: s.past.slice(0, -1),
                future: [snapshotOf(s), ...s.future],
                selection: [],
                mode: { kind: 'canvas' }
            });
        },
        redo() {
            const s = get();
            const next = s.future[0];
            if (!next) {
                return;
            }
            set({
                ...next,
                hidden: hiddenIn(next.nodes),
                past: [...s.past, snapshotOf(s)],
                future: s.future.slice(1),
                selection: [],
                mode: { kind: 'canvas' }
            });
        }
    }));

/* The blank canvas of the window: what a view that is not a canvas reads, and what a unit test reads. */
export const defaultCanvasStore = createCanvasStore();

/* The canvas editors of the window; its blank editor is the store this module made. */
export const defaultCanvases = createEditorRegistry(createCanvasStore, defaultCanvasStore);

/* What a component reads while it renders: the canvas of the cell it is drawn in. */
export const useCanvas = editorHook(defaultCanvases);

/*
 * The canvas store of the cell a component is drawn in, as the store itself. A component that
 * subscribes or writes rather than reads needs this: the hook above has no `getState`, because a
 * component holding one that answers for the cell beside it is the bug this is here to make hard.
 */
export const useCanvasStore = (): StoreApi<CanvasState> => useEditorStoreOf(defaultCanvases);

/*
 * The canvas of the cell that has the focus. This is "the canvas in front of me", which is what a
 * shortcut, a window menu, a palette row or anything else with no cell of its own means. Inside a cell
 * it is the wrong store as often as not: use `useCanvasStore`.
 */
export const focusedCanvas = (): StoreApi<CanvasState> => focusedEditor(defaultCanvases);

/*
 * The editor of the view a node stands on, out of every canvas on screen. What arrives for one node
 * (a title from its CLI, a close, a page's url) is about that node's own view, which in a split is
 * not always the one with the focus.
 */
export const canvasOfNode = (nodeId: string): StoreApi<CanvasState> | null =>
    defaultCanvases.live().find(([, store]) => store.getState().nodes[nodeId] !== undefined)?.[1] ?? null;

/*
 * What a view holds right now. A view on screen is held by its editor, which is fresher than the
 * copy the document keeps of it, so anything asking what a project has must prefer this.
 */
export const liveCanvas = (viewId: string): CanvasState | null => defaultCanvases.peek(viewId)?.getState() ?? null;

/*
 * Selects a node and brings the camera to it once it is on its canvas, for a node the machine writes
 * (a fork) and that arrives with the next `project.changed`. Nothing happens for a canvas not on screen.
 */
export const revealWhenItLands = (viewId: string, nodeId: string): void => {
    const store = defaultCanvases.peek(viewId);
    if (!store) {
        return;
    }
    if (store.getState().nodes[nodeId] !== undefined) {
        store.getState().goToNode(nodeId);
        return;
    }
    const off = store.subscribe((state) => {
        if (state.nodes[nodeId] !== undefined) {
            // Before the move, which is a change this listener would otherwise hear again.
            off();
            state.goToNode(nodeId);
        }
    });
};

/* Every canvas on screen, which is what a watcher about the whole project walks over. */
export const liveCanvases = (): [string, CanvasState][] => defaultCanvases.live().map(([viewId, store]) => [viewId, store.getState()]);

/*
 * Every change in every canvas on screen, and one opening or closing. A watcher that is about the
 * project subscribes here rather than to `useCanvas`, which is one cell and stops being that cell
 * the moment another view takes it.
 */
export const subscribeCanvases = (listener: () => void): (() => void) => defaultCanvases.subscribe(listener);

export const isNodeFocused = (mode: Mode, id: string): boolean => mode.kind === 'node' && mode.nodeId === id;
