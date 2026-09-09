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
import { demoEdges, demoNodes, demoTexts } from '@/data/demo';

export type NodeKind = 'terminal' | 'chat' | 'browser';
export type AgentStatus = 'running' | 'needs-you' | 'idle' | 'error';

export interface CanvasNode extends Rect {
    id: string;
    kind: NodeKind;
    title: string;
    status?: AgentStatus;
    accent?: string;
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

/* Which gestures the canvas refuses. Commands (dock buttons, shortcuts) always work. */
export interface Locks {
    pan: boolean;
    zoom: boolean;
    move: boolean;
    resize: boolean;
}

export type Mode = { kind: 'canvas' } | { kind: 'node'; nodeId: string };

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
    selection: string[];
    mode: Mode;
    editingTextId: string | null;
    locks: Locks;
    /* Node currently under a resize handle, so it can show its size. Transient. */
    resizing: string | null;

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

    moveSelected(dx: number, dy: number): void;
    settleMove(): void;
    resizeNode(id: string, rect: Rect): void;
    setResizing(id: string | null): void;
    bringToFront(id: string): void;
    setNodeAccent(id: string, accent: string | null): void;
    renameNode(id: string, title: string): void;
    duplicateNode(id: string): void;
    addNode(kind: NodeKind, at: Point): string;
    addText(at: Point): string;
    updateText(id: string, text: string): void;
    setEditingText(id: string | null): void;
    deleteSelected(): void;
    toggleLock(key: keyof Locks): void;
    setAllLocks(locked: boolean): void;
}

const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
    terminal: { w: 560, h: 360 },
    chat: { w: 480, h: 520 },
    browser: { w: 720, h: 480 }
};

const TITLES: Record<NodeKind, string> = {
    terminal: 'Terminal',
    chat: 'New chat',
    browser: 'Browser'
};

let counter = 100;
const nextId = (prefix: string): string => `${prefix}-${++counter}`;

export const useCanvas = create<CanvasState>((set, get) => ({
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { w: 0, h: 0 },
    nodes: Object.fromEntries(demoNodes.map((n) => [n.id, n])),
    order: demoNodes.map((n) => n.id),
    texts: Object.fromEntries(demoTexts.map((t) => [t.id, t])),
    edges: demoEdges,
    selection: [],
    mode: { kind: 'canvas' },
    editingTextId: null,
    locks: { pan: false, zoom: false, move: false, resize: false },
    resizing: null,

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
        const rects: Rect[] = [
            ...Object.values(nodes),
            ...Object.values(texts).map((t) => ({ x: t.x, y: t.y, w: t.size * 12, h: t.size * 1.4 }))
        ];
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
            ...Object.values(nodes).filter((n) => intersects(n, rect)).map((n) => n.id),
            ...Object.values(texts).filter((t) => intersects({ x: t.x, y: t.y, w: t.size * 8, h: t.size * 1.4 }, rect)).map((t) => t.id)
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

    moveSelected(dx, dy) {
        const { nodes, texts, selection, locks } = get();
        if (locks.move) {
            return;
        }
        const nextNodes = { ...nodes };
        const nextTexts = { ...texts };
        for (const id of selection) {
            if (nextNodes[id]) {
                nextNodes[id] = { ...nextNodes[id], x: nextNodes[id].x + dx, y: nextNodes[id].y + dy };
            } else if (nextTexts[id]) {
                nextTexts[id] = { ...nextTexts[id], x: nextTexts[id].x + dx, y: nextTexts[id].y + dy };
            }
        }
        set({ nodes: nextNodes, texts: nextTexts });
    },
    settleMove() {
        const { nodes, texts, selection } = get();
        const nextNodes = { ...nodes };
        const nextTexts = { ...texts };
        for (const id of selection) {
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
        set({ resizing: id });
    },
    setNodeAccent(id, accent) {
        set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], accent: accent ?? undefined } } } : {}));
    },
    renameNode(id, title) {
        set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], title } } } : {}));
    },
    duplicateNode(id) {
        const source = get().nodes[id];
        if (!source) {
            return;
        }
        const copyId = nextId(source.kind);
        const copy: CanvasNode = { ...source, id: copyId, x: source.x + 32, y: source.y + 32 };
        set((s) => ({ nodes: { ...s.nodes, [copyId]: copy }, order: [...s.order, copyId], selection: [copyId], mode: { kind: 'canvas' } }));
    },
    bringToFront(id) {
        const { order } = get();
        if (order[order.length - 1] === id) {
            return;
        }
        set({ order: [...order.filter((n) => n !== id), id] });
    },
    addNode(kind, at) {
        const id = nextId(kind);
        const size = NODE_SIZE[kind];
        const node: CanvasNode = {
            id,
            kind,
            title: TITLES[kind],
            x: snapToGrid(at.x - size.w / 2),
            y: snapToGrid(at.y - size.h / 2),
            ...size,
            status: kind === 'chat' ? 'idle' : undefined
        };
        set((s) => ({ nodes: { ...s.nodes, [id]: node }, order: [...s.order, id], selection: [id], mode: { kind: 'canvas' } }));
        return id;
    },
    addText(at) {
        const id = nextId('text');
        const text: TextElement = { id, x: snapToGrid(at.x), y: snapToGrid(at.y), text: '', size: 18 };
        set((s) => ({ texts: { ...s.texts, [id]: text }, selection: [id], editingTextId: id, mode: { kind: 'canvas' } }));
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
        const nextNodes = { ...nodes };
        const nextTexts = { ...texts };
        for (const id of gone) {
            delete nextNodes[id];
            delete nextTexts[id];
        }
        set({
            nodes: nextNodes,
            texts: nextTexts,
            order: order.filter((id) => !gone.has(id)),
            edges: edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
            selection: [],
            mode: { kind: 'canvas' }
        });
    },
    toggleLock(key) {
        set((s) => ({ locks: { ...s.locks, [key]: !s.locks[key] } }));
    },
    setAllLocks(locked) {
        set({ locks: { pan: locked, zoom: locked, move: locked, resize: locked } });
    }
}));

export const isNodeFocused = (mode: Mode, id: string): boolean => mode.kind === 'node' && mode.nodeId === id;
