import type { DiagramDocument, DiagramEdge, DiagramNode } from '@ruimte/contracts';

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface NodeBox extends Rect {
    id: string;
    /* How far down the longest path from a node without incoming edges this node sits. */
    layer: number;
    /* Placed where a person dragged it rather than where the layout would have. */
    pinned: boolean;
}

export interface GroupBox extends Rect {
    id: string;
}

export interface EdgeRoute {
    /* The edge's index in the file, since two edges may join the same two nodes. */
    index: number;
    from: string;
    to: string;
    /* Whole-number corners, first to last, with the head at the last one. */
    points: Point[];
    /* Where the label goes: the middle of the middle segment. */
    labelAt: Point;
}

export interface DiagramLayout {
    /* In file order. */
    nodes: NodeBox[];
    /* In file order; a group that wraps nothing has no box and is left out. */
    groups: GroupBox[];
    /* In file order. */
    edges: EdgeRoute[];
    /* Everything drawn, groups and edge corners included; all zero for an empty diagram. */
    bounds: Rect;
}

export const LABEL_SIZE = 14;
export const SUB_SIZE = 12;
/* A glyph of the sans face is about this wide per unit of size; no DOM means no measuring. */
const GLYPH_RATIO = 0.6;
const NODE_PADDING_X = 16;
const NODE_MIN_WIDTH = 120;
const NODE_MAX_WIDTH = 280;
const NODE_HEIGHT = 44;
const NODE_HEIGHT_WITH_SUB = 60;
/* A diamond holds its text in the middle half of its box, so the box grows around it. */
const DIAMOND_GROWTH = { w: 48, h: 28 };
export const LAYER_GAP = 96;
export const NODE_GAP = 32;
export const GROUP_PADDING = 20;
/* The band on top of a group where its label sits. */
export const GROUP_LABEL_BAND = 24;
/* How far below both boxes an edge that runs against the direction goes around. */
const DETOUR = 28;
const LOOP = 20;
/* Two ends this close across the flow are drawn as one straight line rather than a step too small to read. */
const JOG = 12;

export const estimateTextWidth = (text: string, size: number): number => Math.ceil([...text].length * size * GLYPH_RATIO);

/* The size of a node's box, from what it says and the shape it wears. */
export const sizeOfNode = (node: Pick<DiagramNode, 'label' | 'sub' | 'shape'>): { w: number; h: number } => {
    const text = Math.max(estimateTextWidth(node.label, LABEL_SIZE), node.sub ? estimateTextWidth(node.sub, SUB_SIZE) : 0);
    let w = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, text + NODE_PADDING_X * 2));
    let h = node.sub ? NODE_HEIGHT_WITH_SUB : NODE_HEIGHT;
    if (node.shape === 'diamond') {
        w += DIAMOND_GROWTH.w;
        h += DIAMOND_GROWTH.h;
    }
    return { w, h };
};

/*
 * The layer of every node: the longest path to it from a node without incoming edges. A cycle has
 * no such path, so it is broken first by a depth-first walk in file order (sources first, then every
 * node still unvisited) and every edge that points back at a node still on the walk is left out of
 * the layering. The walk only depends on the order of the file, so the same file breaks the same edges.
 */
export const layersOf = (nodes: readonly Pick<DiagramNode, 'id'>[], edges: readonly Pick<DiagramEdge, 'from' | 'to'>[]): Map<string, number> => {
    const known = new Set(nodes.map((node) => node.id));
    const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
    const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]));
    for (const edge of edges) {
        // An edge to an id that is not there is refused before a layout is asked for; a loop has no direction to rank.
        if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) {
            continue;
        }
        outgoing.get(edge.from)!.push(edge.to);
        incoming.set(edge.to, incoming.get(edge.to)! + 1);
    }

    const ON_WALK = 1;
    const DONE = 2;
    const state = new Map<string, number>();
    const forward = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
    const roots = [...nodes.filter((node) => incoming.get(node.id) === 0), ...nodes];
    for (const root of roots) {
        if (state.has(root.id)) {
            continue;
        }
        // Iterative, so a long chain written by an agent cannot run the stack out.
        const stack: { id: string; next: number }[] = [{ id: root.id, next: 0 }];
        state.set(root.id, ON_WALK);
        while (stack.length > 0) {
            const top = stack.at(-1)!;
            const targets = outgoing.get(top.id)!;
            if (top.next === targets.length) {
                state.set(top.id, DONE);
                stack.pop();
                continue;
            }
            const target = targets[top.next]!;
            top.next += 1;
            const seen = state.get(target);
            if (seen === ON_WALK) {
                continue;
            }
            forward.get(top.id)!.push(target);
            if (seen === undefined) {
                state.set(target, ON_WALK);
                stack.push({ id: target, next: 0 });
            }
        }
    }

    // What is left is acyclic, so a topological pass settles every longest path.
    const remaining = new Map<string, number>(nodes.map((node) => [node.id, 0]));
    for (const targets of forward.values()) {
        for (const target of targets) {
            remaining.set(target, remaining.get(target)! + 1);
        }
    }
    const layers = new Map<string, number>(nodes.map((node) => [node.id, 0]));
    const ready = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
    for (let i = 0; i < ready.length; i++) {
        const id = ready[i]!;
        for (const target of forward.get(id)!) {
            layers.set(target, Math.max(layers.get(target)!, layers.get(id)! + 1));
            const left = remaining.get(target)! - 1;
            remaining.set(target, left);
            if (left === 0) {
                ready.push(target);
            }
        }
    }
    return layers;
};

/* The layout works in the frame of a diagram that runs to the right; one that runs down is that frame mirrored across the diagonal. */
const flip = <T extends Rect>(box: T): T => ({ ...box, x: box.y, y: box.x, w: box.h, h: box.w });

const flipPoint = (point: Point): Point => ({ x: point.y, y: point.x });

const center = (box: Rect): Point => ({ x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) });

const withElbow = (start: Point, end: Point, horizontal: boolean): Point[] => {
    const across = horizontal ? end.y - start.y : end.x - start.x;
    if (Math.abs(across) <= JOG) {
        return [horizontal ? { x: start.x, y: end.y } : { x: end.x, y: start.y }, end];
    }
    if (horizontal) {
        const middle = Math.round((start.x + end.x) / 2);
        return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
    }
    const middle = Math.round((start.y + end.y) / 2);
    return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
};

/* One edge in the frame that runs to the right: along the flow when it can, around underneath when it points back. */
const route = (source: Rect, target: Rect, loop: boolean): Point[] => {
    const from = center(source);
    const to = center(target);
    if (loop) {
        const right = source.x + source.w;
        return [
            { x: right - LOOP, y: source.y },
            { x: right - LOOP, y: source.y - LOOP },
            { x: right + LOOP, y: source.y - LOOP },
            { x: right + LOOP, y: from.y },
            { x: right, y: from.y }
        ];
    }
    if (target.x >= source.x + source.w) {
        return withElbow({ x: source.x + source.w, y: from.y }, { x: target.x, y: to.y }, true);
    }
    if (target.x + target.w <= source.x) {
        const below = Math.max(source.y + source.h, target.y + target.h) + DETOUR;
        return [
            { x: from.x, y: source.y + source.h },
            { x: from.x, y: below },
            { x: to.x, y: below },
            { x: to.x, y: target.y + target.h }
        ];
    }
    // The two share a column, so the edge runs across the flow from one to the other.
    return to.y < from.y
        ? withElbow({ x: from.x, y: source.y }, { x: to.x, y: target.y + target.h }, false)
        : withElbow({ x: from.x, y: source.y + source.h }, { x: to.x, y: target.y }, false);
};

const labelPoint = (points: readonly Point[]): Point => {
    const at = Math.max(0, Math.floor((points.length - 2) / 2));
    const start = points[at]!;
    const end = points[at + 1] ?? start;
    return { x: Math.round((start.x + end.x) / 2), y: Math.round((start.y + end.y) / 2) };
};

const unionOf = (rects: readonly Rect[]): Rect => {
    if (rects.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.w));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
};

/*
 * Where everything in a diagram goes. Layers run along the direction, the file order runs across
 * it, and every coordinate is a whole number. A node with `pos` sits there and gives up its place in
 * its layer, so the rest close up around it. No measuring and no randomness: two machines with the
 * same file draw the same picture.
 */
export const layoutOf = (document: Pick<DiagramDocument, 'meta' | 'nodes' | 'groups' | 'edges'>): DiagramLayout => {
    const down = document.meta.direction === 'down';
    const layers = layersOf(document.nodes, document.edges);
    const groupOf = new Map<string, string>();
    for (const group of document.groups) {
        for (const id of group.wraps) {
            if (!groupOf.has(id)) {
                groupOf.set(id, group.id);
            }
        }
    }

    // Sized in the right-running frame, so a diagram that runs down is the same code turned over.
    const sized = document.nodes.map((node) => {
        const size = sizeOfNode(node);
        return { node, layer: layers.get(node.id) ?? 0, w: down ? size.h : size.w, h: down ? size.w : size.h };
    });
    const layerCount = sized.reduce((count, entry) => Math.max(count, entry.layer + 1), 0);
    const columns = Array.from({ length: layerCount }, () => [] as typeof sized);
    for (const entry of sized) {
        if (!entry.node.pos) {
            columns[entry.layer]!.push(entry);
        }
    }

    // Where every node starts across the flow inside its layer, before the layer is centered.
    const offsets = columns.map((column) => {
        let y = 0;
        let previousGroup: string | null | undefined;
        const starts = column.map((entry) => {
            const group = groupOf.get(entry.node.id) ?? null;
            if (previousGroup !== undefined) {
                // Where one group ends and another begins, both boxes and a label band need room.
                const between = group === previousGroup ? 0 : GROUP_PADDING * 2 + (down ? 0 : GROUP_LABEL_BAND);
                y += NODE_GAP + between;
            }
            previousGroup = group;
            const start = y;
            y += entry.h;
            return start;
        });
        return { starts, extent: y };
    });
    const widestExtent = offsets.reduce((widest, offset) => Math.max(widest, offset.extent), 0);

    const placed = new Map<string, NodeBox>();
    let x = 0;
    columns.forEach((column, layer) => {
        const width = column.reduce((widest, entry) => Math.max(widest, entry.w), 0);
        // Every layer is centered on the same line across the flow, so a chain of single nodes runs straight.
        const shift = Math.round((widestExtent - offsets[layer]!.extent) / 2);
        column.forEach((entry, index) => {
            placed.set(entry.node.id, {
                id: entry.node.id,
                x: x + Math.round((width - entry.w) / 2),
                y: shift + offsets[layer]!.starts[index]!,
                w: entry.w,
                h: entry.h,
                layer: entry.layer,
                pinned: false
            });
        });
        x += width + LAYER_GAP;
    });

    const nodes: NodeBox[] = sized.map((entry) => {
        const box = placed.get(entry.node.id);
        const frame = box ? (down ? flip(box) : box) : null;
        if (frame) {
            return frame;
        }
        const [px, py] = entry.node.pos!;
        const size = sizeOfNode(entry.node);
        return { id: entry.node.id, x: Math.round(px), y: Math.round(py), w: size.w, h: size.h, layer: entry.layer, pinned: true };
    });
    const byId = new Map(nodes.map((box) => [box.id, box]));

    const groups: GroupBox[] = document.groups.flatMap((group) => {
        const members = group.wraps.flatMap((id) => {
            const box = byId.get(id);
            return box ? [box] : [];
        });
        if (members.length === 0) {
            return [];
        }
        const inner = unionOf(members);
        return [
            {
                id: group.id,
                x: inner.x - GROUP_PADDING,
                y: inner.y - GROUP_PADDING - GROUP_LABEL_BAND,
                w: inner.w + GROUP_PADDING * 2,
                h: inner.h + GROUP_PADDING * 2 + GROUP_LABEL_BAND
            }
        ];
    });

    const edges: EdgeRoute[] = document.edges.flatMap((edge, index) => {
        const source = byId.get(edge.from);
        const target = byId.get(edge.to);
        if (!source || !target) {
            return [];
        }
        const loop = edge.from === edge.to;
        const points = down ? route(flip(source), flip(target), loop).map(flipPoint) : route(source, target, loop);
        return [{ index, from: edge.from, to: edge.to, points, labelAt: labelPoint(points) }];
    });

    const corners = edges.flatMap((edge) => edge.points.map((point) => ({ ...point, w: 0, h: 0 })));
    return { nodes, groups, edges, bounds: unionOf([...nodes, ...groups, ...corners]) };
};
