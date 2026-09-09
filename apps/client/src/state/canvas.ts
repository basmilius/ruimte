import { create } from 'zustand';
import {
    cameraCenteredOn,
    cameraToFit,
    clampZoom,
    intersects,
    snapToGrid,
    snapZoom,
    unionRect,
    zoomAround,
    type Camera,
    type Point,
    type Rect
} from '@/canvas/math';

import type { AgentStatus, NodeKind, ProjectContent, ProjectDocument, ProjectLayout, ProjectLocal, ProjectNode } from '@ruimte/contracts';

export type { AgentStatus, NodeKind } from '@ruimte/contracts';

/* A node as stored in the project file, plus a status for kinds without a daemon-side one (browser). */
export interface CanvasNode extends ProjectNode {
    status?: AgentStatus;
}

export interface AddNodeOptions {
    title?: string;
    cwd?: string;
    command?: string;
    resume?: string;
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

/* An edge being drawn: from a node or text to wherever the pointer is, in world units. */
export interface LinkDraft {
    from: string;
    to: Point;
}

// A collapsed group is its header only.
export const GROUP_HEADER_PX = 37;

/* Which gestures the canvas refuses. Commands (dock buttons, shortcuts) always work. */
export interface Locks {
    pan: boolean;
    zoom: boolean;
    move: boolean;
    resize: boolean;
}

export type Mode = { kind: 'canvas' } | { kind: 'node'; nodeId: string };

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

interface CanvasState {
    camera: Camera;
    viewport: Viewport;
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
    bringToFront(id: string): void;
    setNodeAccent(id: string, accent: string | null): void;
    renameNode(id: string, title: string): void;
    /* Changes what a node carries (its page, its folder) without touching its placement. */
    updateNode(id: string, patch: Partial<Pick<CanvasNode, 'url' | 'cwd' | 'command' | 'resume' | 'escapeToApp'>>): void;
    duplicateNode(id: string): void;
    addNode(kind: NodeKind, at: Point, options?: AddNodeOptions): string;
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
    /* Edges: only an agent node (terminal or chat) can be the target. */
    addEdge(from: string, to: string): string | null;
    removeEdge(id: string): void;
    setEdgeLabel(id: string, label: string): void;
    setLinkDraft(draft: LinkDraft | null): void;
    saveLayout(name: string): void;
    applyLayout(name: string): void;
    deleteLayout(name: string): void;

    /* Replaces the whole canvas with a project's content; the camera comes from the machine-local state. */
    loadDocument(document: ProjectDocument | null, local: ProjectLocal | null): void;
    exportContent(): Pick<ProjectContent, 'nodes' | 'texts' | 'edges' | 'layouts'>;
    undo(): void;
    redo(): void;
}

const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
    terminal: { w: 560, h: 360 },
    chat: { w: 480, h: 520 },
    browser: { w: 720, h: 480 },
    group: { w: 800, h: 600 }
};

const TITLES: Record<NodeKind, string> = {
    terminal: 'Terminal',
    chat: 'New chat',
    browser: 'Browser',
    group: 'Group'
};

// Room a group keeps around the nodes it was made for.
const GROUP_PADDING = 32;
const GROUP_HEADER = 40;

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
const nextId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const snapshotOf = (s: Pick<CanvasState, 'nodes' | 'order' | 'texts' | 'edges' | 'layouts'>): Snapshot => ({
    nodes: s.nodes,
    order: s.order,
    texts: s.texts,
    edges: s.edges,
    layouts: s.layouts
});

/* Remembers the placement before a change; called by every action that changes it. */
const remember = (s: CanvasState): Pick<CanvasState, 'past' | 'future'> => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), snapshotOf(s)], future: [] });

export const useCanvas = create<CanvasState>((set, get) => ({
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { w: 0, h: 0 },
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
    loading: false,
    past: [],
    future: [],

    setViewport(viewport) {
        set({ viewport });
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
        if (bounds && viewport.w > 0) {
            set({ camera: cameraToFit(bounds, viewport) });
        }
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
        if (bounds) {
            set({ camera: cameraToFit(bounds, viewport, 96, 1.5) });
        }
    },
    goToNode(id) {
        const { nodes, viewport, camera } = get();
        const node = nodes[id];
        if (!node) {
            return;
        }
        set({ camera: cameraCenteredOn(node, viewport, Math.max(camera.zoom, 0.75)), selection: [id], mode: { kind: 'canvas' } });
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
    setNodeAccent(id, accent) {
        set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], accent: accent ?? undefined } } } : {}));
    },
    renameNode(id, title) {
        set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], title } } } : {}));
    },
    updateNode(id, patch) {
        set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } } } : {}));
    },
    duplicateNode(id) {
        const source = get().nodes[id];
        if (!source) {
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
        const id = nextId(kind);
        const size = NODE_SIZE[kind];
        // Made inside a group that is bound to a worktree, a node starts in that checkout.
        const host = Object.values(get().nodes)
            .filter((node) => node.kind === 'group' && node.worktree && contains(node, at))
            .sort((a, b) => a.w * a.h - b.w * b.h)[0];
        const node: CanvasNode = {
            id,
            kind,
            title: options.title ?? TITLES[kind],
            x: snapToGrid(at.x - size.w / 2),
            y: snapToGrid(at.y - size.h / 2),
            ...size,
            cwd: options.cwd ?? host?.worktree?.path,
            command: options.command,
            resume: options.resume
        };
        set((s) => ({ nodes: { ...s.nodes, [id]: node }, order: [...s.order, id], selection: [id], mode: { kind: 'canvas' }, ...remember(s) }));
        return id;
    },
    groupSelection() {
        const { nodes, selection } = get();
        const members = selection.map((id) => nodes[id]).filter((node): node is CanvasNode => Boolean(node) && node!.kind !== 'group');
        const bounds = unionRect(members);
        if (!bounds) {
            return null;
        }
        const id = nextId('group');
        const group: CanvasNode = {
            id,
            kind: 'group',
            title: TITLES.group,
            x: snapToGrid(bounds.x - GROUP_PADDING),
            y: snapToGrid(bounds.y - GROUP_PADDING - GROUP_HEADER),
            w: snapToGrid(bounds.w + GROUP_PADDING * 2),
            h: snapToGrid(bounds.h + GROUP_PADDING * 2 + GROUP_HEADER)
        };
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
        const target = s.nodes[to];
        if (from === to || !target || (target.kind !== 'chat' && target.kind !== 'terminal') || !(s.nodes[from] || s.texts[from])) {
            return null;
        }
        if (s.edges.some((edge) => edge.from === from && edge.to === to)) {
            return null;
        }
        const id = nextId('edge');
        set({ edges: [...s.edges, { id, from, to, label: 'context' }], ...remember(s) });
        return id;
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

    loadDocument(document, local) {
        const nodes = document ? Object.fromEntries(document.nodes.map((node) => [node.id, node])) : {};
        const texts = document ? Object.fromEntries(document.texts.map((text) => [text.id, text])) : {};
        set({
            loading: true,
            nodes,
            order: document ? document.nodes.map((node) => node.id) : [],
            texts,
            edges: document?.edges ?? [],
            layouts: document?.layouts ?? [],
            linkDraft: null,
            hidden: hiddenIn(nodes),
            selection: [],
            mode: { kind: 'canvas' },
            editingTextId: null,
            resizing: null,
            past: [],
            future: [],
            ...(local?.camera ? { camera: local.camera } : {})
        });
        set({ loading: false });
        if (!local?.camera) {
            get().fitAll();
        }
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
        set({ ...next, hidden: hiddenIn(next.nodes), past: [...s.past, snapshotOf(s)], future: s.future.slice(1), selection: [], mode: { kind: 'canvas' } });
    }
}));

export const isNodeFocused = (mode: Mode, id: string): boolean => mode.kind === 'node' && mode.nodeId === id;
