import type { DiagramDocument, DiagramEdge, DiagramNode, DiagramShape } from '@ruimte/contracts';
import { unionOf } from '@ruimte/drawing';
import { placeAcross } from './across.ts';
import { DUMMY_MARGIN, NODE_MARGIN, bandCode, type Band, type Hop, type Unit } from './graph.ts';
import { orderLayers } from './order.ts';
import { routeChannel, type ChannelHop, type ChannelLabel } from './route.ts';
import { LABEL_LINE, LABEL_SIZE, SUB_LINE, SUB_SIZE, estimateTextWidth, widestLine, wrapText } from './text.ts';

export { LABEL_LINE, LABEL_SIZE, SUB_LINE, SUB_SIZE, estimateTextWidth, wrapText } from './text.ts';

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
    /* The label and the line under it, wrapped the way the box was sized for. */
    label: string[];
    sub: string[];
}

export interface GroupBox extends Rect {
    id: string;
    /* Where the group's label is drawn, estimated like every other text. */
    labelBox: Rect;
}

export interface EdgeLabelBox extends Rect {
    lines: string[];
}

export interface EdgeRoute {
    /* The edge's index in the file, since two edges may join the same two nodes. */
    index: number;
    from: string;
    to: string;
    /* Whole-number corners, first to last, with the head at the last one. */
    points: Point[];
    /* Where the label goes, or null for an edge without one. */
    label: EdgeLabelBox | null;
}

export interface DiagramLayout {
    /* In file order. */
    nodes: NodeBox[];
    /* In file order; a group that wraps nothing has no box and is left out. */
    groups: GroupBox[];
    /* In file order. */
    edges: EdgeRoute[];
    /* Everything drawn, groups, labels and edge corners included; all zero for an empty diagram. */
    bounds: Rect;
}

const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 13;
const NODE_MIN_WIDTH = 120;
export const NODE_MAX_WIDTH = 280;
const TEXT_MAX_WIDTH = NODE_MAX_WIDTH - NODE_PADDING_X * 2;
/* A diamond holds its text in the middle of its box, so its lines are shorter and the box is twice their size. */
const DIAMOND_TEXT_MAX_WIDTH = 160;
const DIAMOND_MIN = { w: 168, h: 72 };
/* The extra height of a cylinder, for the lid its text stays under. */
export const CYLINDER_LID = 10;
export const EDGE_LABEL_MAX_WIDTH = 160;
export const EDGE_LABEL_PADDING = { x: 4, y: 2 };
export const GROUP_PADDING = 20;
/* The band on top of a group where its label sits. */
export const GROUP_LABEL_BAND = 24;
export const GROUP_LABEL_INSET = 12;
/* Room between a layer's widest box and the first thing in the channel after it. */
const EDGE_CLEAR = 20;
/* How far a loop on one node reaches out of its box. */
const LOOP = 16;
/* Ports on one side of a box keep this far apart, and this far from its corners. */
const PORT_GAP = 12;
const PORT_INSET = 10;
/* A hop whose two ends are this close across the flow is drawn straight when one end has room to move. */
const SNAP = 6;

const even = (value: number): number => Math.ceil(value / 2) * 2;

export interface NodeSize {
    w: number;
    h: number;
    label: string[];
    sub: string[];
}

/* The size of a node's box, from what it says wrapped to the widest a box gets, and the shape it wears. */
export const sizeOfNode = (node: Pick<DiagramNode, 'label' | 'sub' | 'shape'>): NodeSize => {
    const diamond = node.shape === 'diamond';
    const maxWidth = diamond ? DIAMOND_TEXT_MAX_WIDTH : TEXT_MAX_WIDTH;
    const label = wrapText(node.label, LABEL_SIZE, true, maxWidth);
    const sub = node.sub ? wrapText(node.sub, SUB_SIZE, false, maxWidth) : [];
    const textWidth = Math.max(widestLine(label, LABEL_SIZE, true), widestLine(sub, SUB_SIZE, false));
    const textHeight = label.length * LABEL_LINE + sub.length * SUB_LINE;
    if (diamond) {
        // A rhombus twice the size of a rectangle holds that rectangle with its corners on the outline.
        return { w: even(Math.max(DIAMOND_MIN.w, (textWidth + 16) * 2)), h: even(Math.max(DIAMOND_MIN.h, (textHeight + 8) * 2)), label, sub };
    }
    let h = textHeight + NODE_PADDING_Y * 2;
    // The round ends of a pill eat into the room of its outer lines.
    const paddingX = node.shape === 'pill' ? Math.max(NODE_PADDING_X, Math.round(h / 2) - 4) : NODE_PADDING_X;
    if (node.shape === 'cylinder') {
        h += CYLINDER_LID;
    }
    return { w: even(Math.max(NODE_MIN_WIDTH, textWidth + paddingX * 2)), h: even(h), label, sub };
};

/* The box of an edge's label before it is placed: wrapped narrower than a node, on a padding of its own. */
export const sizeOfEdgeLabel = (text: string): { w: number; h: number; lines: string[] } => {
    const lines = wrapText(text, SUB_SIZE, false, EDGE_LABEL_MAX_WIDTH);
    return {
        w: even(widestLine(lines, SUB_SIZE, false) + EDGE_LABEL_PADDING.x * 2),
        h: lines.length * SUB_LINE + EDGE_LABEL_PADDING.y * 2,
        lines
    };
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

const overlapsRect = (left: Rect, right: Rect): boolean =>
    left.x < right.x + right.w && right.x < left.x + left.w && left.y < right.y + right.h && right.y < left.y + left.h;

/* Drops repeated corners and corners in the middle of a straight run. */
const simplify = (points: readonly Point[]): Point[] => {
    const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
    return unique.filter((point, index) => {
        const before = unique[index - 1];
        const after = unique[index + 1];
        if (!before || !after) {
            return true;
        }
        return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y));
    });
};

/*
 * How far inside the side of its box a shape's outline is, at `offset` from the middle of that side,
 * in the right-running frame, so an arrowhead lands on the outline rather than on the box.
 */
const insetOf = (shape: DiagramShape | undefined, box: Rect, offset: number, down: boolean): number => {
    const away = Math.abs(offset);
    const half = box.h / 2;
    const rounded = (radius: number): number => {
        const straight = half - radius;
        if (away <= straight) {
            return 0;
        }
        const into = Math.min(radius, away - straight);
        return Math.round(radius - Math.sqrt(radius * radius - into * into));
    };
    switch (shape ?? 'rect') {
        case 'round':
            return rounded(Math.min(10, box.w / 2, half));
        case 'pill':
            return rounded(Math.min(box.w, box.h) / 2);
        case 'diamond':
            return Math.round((Math.min(away, half) / half) * (box.w / 2));
        case 'cylinder': {
            // Running down, the side a hop meets is a lid, an ellipse as deep as the lid and as wide as the box.
            if (!down) {
                return 0;
            }
            const radiusX = Math.round(box.h / 2);
            const radiusY = Math.round(Math.round(box.w * 0.18) / 2);
            const share = Math.min(1, away / radiusX);
            return Math.round(radiusY - radiusY * Math.sqrt(1 - share * share));
        }
        default:
            return 0;
    }
};

/* An edge with an end the layout did not place: straight out of one box and into the other, with one elbow. */
const looseRoute = (source: Rect, target: Rect, loop: boolean, down: boolean): Point[] => {
    const from = center(source);
    const to = center(target);
    if (loop) {
        const right = source.x + source.w;
        return [
            { x: right, y: from.y - 6 },
            { x: right + LOOP, y: from.y - 6 },
            { x: right + LOOP, y: from.y + 6 },
            { x: right, y: from.y + 6 }
        ];
    }
    // A diagram that runs down leaves a box downwards whenever the two are stacked, as its laid-out
    // edges do; otherwise a dragged node's edges would come out of its side against the flow.
    const stacked = target.y >= source.y + source.h || target.y + target.h <= source.y;
    if (!(down && stacked) && target.x >= source.x + source.w) {
        const middle = Math.round((source.x + source.w + target.x) / 2);
        return simplify([
            { x: source.x + source.w, y: from.y },
            { x: middle, y: from.y },
            { x: middle, y: to.y },
            { x: target.x, y: to.y }
        ]);
    }
    if (!(down && stacked) && target.x + target.w <= source.x) {
        const middle = Math.round((target.x + target.w + source.x) / 2);
        return simplify([
            { x: source.x, y: from.y },
            { x: middle, y: from.y },
            { x: middle, y: to.y },
            { x: target.x + target.w, y: to.y }
        ]);
    }
    const middle = Math.round((from.y + to.y) / 2);
    const start = to.y < from.y ? source.y : source.y + source.h;
    const end = to.y < from.y ? target.y + target.h : target.y;
    return simplify([
        { x: from.x, y: start },
        { x: from.x, y: middle },
        { x: to.x, y: middle },
        { x: to.x, y: end }
    ]);
};

interface Chain {
    edge: number;
    hops: number[];
    /* The edge runs against the flow, so its hops were made from its target and its points are turned around. */
    reversed: boolean;
}

interface Loop {
    edge: number;
    unit: number;
}

interface Port {
    key: number;
    edge: number;
    order: number;
    apply: (y: number) => void;
}

/*
 * Deterministic layered layout with integer coordinates. Barycenter sweeps order unpinned nodes;
 * pinned nodes keep their position, and skipped layers give edges explicit routing points.
 */
export const layoutOf = (document: Pick<DiagramDocument, 'meta' | 'nodes' | 'groups' | 'edges'>): DiagramLayout => {
    const down = document.meta.direction === 'down';
    const layers = layersOf(document.nodes, document.edges);
    const sizes = document.nodes.map((node) => sizeOfNode(node));
    const knownIds = new Set(document.nodes.map((node) => node.id));

    // Every node that is not pinned is a unit, sized in the right-running frame.
    const units: Unit[] = [];
    const unitOf = new Map<string, number>();
    const unitOfNode = new Map<number, number>();
    document.nodes.forEach((node, index) => {
        if (node.pos) {
            return;
        }
        const size = sizes[index]!;
        unitOf.set(node.id, units.length);
        unitOfNode.set(index, units.length);
        units.push({
            layer: layers.get(node.id) ?? 0,
            node: index,
            band: -1,
            w: down ? size.h : size.w,
            h: down ? size.w : size.h,
            margin: NODE_MARGIN,
            line: -1,
            up: [],
            down: []
        });
    });

    const bands: Band[] = [];
    const bandOfGroup = new Map<number, number>();
    document.groups.forEach((group, groupIndex) => {
        const inside = group.wraps.flatMap((id) => {
            const unit = unitOf.get(id);
            return unit === undefined || units[unit]!.band >= 0 ? [] : [unit];
        });
        if (inside.length === 0) {
            return;
        }
        const first = Math.min(...inside.map((unit) => units[unit]!.layer));
        const last = Math.max(...inside.map((unit) => units[unit]!.layer));
        bandOfGroup.set(groupIndex, bands.length);
        for (const unit of inside) {
            units[unit]!.band = bands.length;
        }
        bands.push({
            group: groupIndex,
            first,
            last,
            members: Array.from({ length: last - first + 1 }, () => []),
            top: 0,
            height: 0,
            before: GROUP_PADDING + (down ? 0 : GROUP_LABEL_BAND),
            after: GROUP_PADDING,
            rank: 0,
            labelWidth: estimateTextWidth(group.label, SUB_SIZE, true)
        });
    });

    const hops: Hop[] = [];
    const chains: Chain[] = [];
    const loops: Loop[] = [];
    const loose: number[] = [];
    const lines: number[][] = [];
    document.edges.forEach((edge, index) => {
        if (!knownIds.has(edge.from) || !knownIds.has(edge.to)) {
            return;
        }
        const source = unitOf.get(edge.from);
        const target = unitOf.get(edge.to);
        if (source === undefined || target === undefined) {
            loose.push(index);
            return;
        }
        if (source === target) {
            loops.push({ edge: index, unit: source });
            return;
        }
        const reversed = units[source]!.layer > units[target]!.layer;
        const low = reversed ? target : source;
        const high = reversed ? source : target;
        if (units[low]!.layer === units[high]!.layer) {
            loose.push(index);
            return;
        }
        // A point of an edge between two members of one group belongs inside that group.
        const band = units[low]!.band >= 0 && units[low]!.band === units[high]!.band ? units[low]!.band : -1;
        const chain: number[] = [];
        const line: number[] = [];
        let previous = low;
        for (let layer = units[low]!.layer + 1; layer <= units[high]!.layer; layer++) {
            let next = high;
            if (layer < units[high]!.layer) {
                next = units.length;
                line.push(next);
                units.push({ layer, node: -1, band, w: 0, h: 0, margin: DUMMY_MARGIN, line: lines.length, up: [], down: [] });
            }
            chain.push(hops.length);
            hops.push({ edge: index, from: previous, to: next });
            units[previous]!.down.push(next);
            units[next]!.up.push(previous);
            previous = next;
        }
        if (line.length > 0) {
            lines.push(line);
        }
        chains.push({ edge: index, hops: chain, reversed });
    });

    const layerCount = units.reduce((count, unit) => Math.max(count, unit.layer + 1), 0);
    const items: number[][] = Array.from({ length: layerCount }, () => []);
    units.forEach((unit, index) => {
        if (unit.band < 0) {
            items[unit.layer]!.push(index);
            return;
        }
        const band = bands[unit.band]!;
        const slot = band.members[unit.layer - band.first]!;
        if (slot.length === 0) {
            items[unit.layer]!.push(bandCode(unit.band));
        }
        slot.push(index);
    });
    bands.forEach((band, index) => {
        band.members.forEach((slot, offset) => {
            if (slot.length === 0) {
                items[band.first + offset]!.push(bandCode(index));
            }
        });
        const tallest = band.members.reduce((most, slot) => {
            const extent = slot.reduce(
                (sum, unit, position) => sum + units[unit]!.h + (position > 0 ? units[slot[position - 1]!]!.margin + units[unit]!.margin : 0),
                0
            );
            return Math.max(most, extent);
        }, 0);
        band.height = band.before + tallest + band.after;
        if (down) {
            // Running down, a group's label runs across the flow, so the group is at least as wide as it.
            band.height = Math.max(band.height, band.labelWidth + GROUP_LABEL_INSET * 2);
        }
    });

    const layering = { units, hops, bands, lines, items };
    orderLayers(layering);
    const top = placeAcross(layering);
    const centerOf = (unit: number): number => top[unit]! + units[unit]!.h / 2;

    // Ports: every hop leaves its box on the side facing the flow and enters on the side facing back.
    const hopStart = new Array<number>(hops.length).fill(0);
    const hopEnd = new Array<number>(hops.length).fill(0);
    const loopStart = new Array<number>(loops.length).fill(0);
    const loopEnd = new Array<number>(loops.length).fill(0);
    const exits: Port[][] = units.map(() => []);
    const entries: Port[][] = units.map(() => []);
    hops.forEach((hop, index) => {
        exits[hop.from]!.push({ key: centerOf(hop.to), edge: hop.edge, order: 0, apply: (y) => (hopStart[index] = y) });
        entries[hop.to]!.push({ key: centerOf(hop.from), edge: hop.edge, order: 0, apply: (y) => (hopEnd[index] = y) });
    });
    loops.forEach((loop, index) => {
        const key = centerOf(loop.unit);
        exits[loop.unit]!.push(
            { key, edge: loop.edge, order: 0, apply: (y) => (loopStart[index] = y) },
            { key, edge: loop.edge, order: 1, apply: (y) => (loopEnd[index] = y) }
        );
    });
    const spread = (unit: number, ports: Port[]): void => {
        if (ports.length === 0) {
            return;
        }
        // In the order of the other ends, so two hops leaving one box do not cross on the way out.
        ports.sort((left, right) => left.key - right.key || left.edge - right.edge || left.order - right.order);
        const middle = centerOf(unit);
        const room = Math.max(0, units[unit]!.h - PORT_INSET * 2);
        const step = ports.length > 1 ? Math.min(PORT_GAP, Math.floor(room / (ports.length - 1))) : 0;
        ports.forEach((port, index) => port.apply(Math.round(middle + (index - (ports.length - 1) / 2) * step)));
    };
    units.forEach((_, unit) => {
        spread(unit, exits[unit]!);
        spread(unit, entries[unit]!);
    });
    const hasRoomAt = (unit: number, y: number): boolean =>
        units[unit]!.node >= 0 && y >= top[unit]! + PORT_INSET && y <= top[unit]! + units[unit]!.h - PORT_INSET;
    hops.forEach((hop, index) => {
        const gap = Math.abs(hopEnd[index]! - hopStart[index]!);
        if (gap === 0 || gap > SNAP) {
            return;
        }
        if (entries[hop.to]!.length === 1 && hasRoomAt(hop.to, hopStart[index]!)) {
            hopEnd[index] = hopStart[index]!;
        } else if (exits[hop.from]!.length === 1 && hasRoomAt(hop.from, hopEnd[index]!)) {
            hopStart[index] = hopEnd[index]!;
        }
    });

    const byLayer: number[][] = Array.from({ length: layerCount }, () => []);
    units.forEach((unit, index) => byLayer[unit.layer]!.push(index));
    const columnWidth = byLayer.map((column) => even(column.reduce((widest, unit) => Math.max(widest, units[unit]!.w), 0)));
    const columnX = new Array<number>(layerCount).fill(0);
    const unitX = new Array<number>(units.length).fill(0);
    const hopsByLayer: number[][] = Array.from({ length: layerCount }, () => []);
    hops.forEach((hop, index) => hopsByLayer[units[hop.from]!.layer]!.push(index));

    const labelSizes = document.edges.map((edge) => (edge.label ? sizeOfEdgeLabel(edge.label) : null));
    const labelHop = new Map<number, number>();
    for (const chain of chains) {
        if (labelSizes[chain.edge]) {
            labelHop.set(chain.hops[Math.floor((chain.hops.length - 1) / 2)]!, chain.edge);
        }
    }
    const frameLabels = new Map<number, Rect>();
    const trackX = new Map<number, number>();

    const alongBefore = GROUP_PADDING + (down ? GROUP_LABEL_BAND : 0);
    const bandAlongStart = (band: Band): number => Math.min(...band.members[0]!.map((unit) => unitX[unit]!)) - alongBefore;
    for (let layer = 0; layer < layerCount; layer++) {
        for (const unit of byLayer[layer]!) {
            unitX[unit] = columnX[layer]! + Math.floor((columnWidth[layer]! - units[unit]!.w) / 2);
        }
        if (layer === layerCount - 1) {
            break;
        }
        const start = columnX[layer]! + columnWidth[layer]!;
        const channelHops: ChannelHop[] = hopsByLayer[layer]!.map((hop) => ({ hop, ya: hopStart[hop]!, yb: hopEnd[hop]! }));
        const channelLabels: ChannelLabel[] = [];
        for (const hop of hopsByLayer[layer]!) {
            const edge = labelHop.get(hop);
            const size = edge === undefined ? null : labelSizes[edge];
            if (edge !== undefined && size) {
                channelLabels.push({ edge, hop, y: hopStart[hop]!, along: down ? size.h : size.w, across: down ? size.w : size.h });
            }
        }
        loops.forEach((loop, index) => {
            const size = labelSizes[loop.edge];
            if (size && units[loop.unit]!.layer === layer) {
                channelLabels.push({ edge: loop.edge, hop: -1, y: loopEnd[index]!, along: down ? size.h : size.w, across: down ? size.w : size.h });
            }
        });
        channelLabels.sort((left, right) => left.edge - right.edge);
        const obstacles: { y: number; h: number }[] = [];
        for (const band of bands) {
            if (band.first > layer || band.last <= layer) {
                continue;
            }
            // A group that runs through the channel crosses it with its two borders, and running right with its label band.
            obstacles.push({ y: band.top - 3, h: down ? 6 : GROUP_LABEL_BAND }, { y: band.top + band.height - 3, h: 6 });
        }
        const endsHere = bands.some((band) => band.last === layer);
        const startsNext = bands.some((band) => band.first === layer + 1);
        const channel = routeChannel({
            start,
            clearBefore: EDGE_CLEAR + (endsHere ? GROUP_PADDING : 0),
            clearAfter: EDGE_CLEAR + (startsNext ? alongBefore : 0),
            hops: channelHops,
            labels: channelLabels,
            obstacles
        });
        channel.trackX.forEach((x, hop) => trackX.set(hop, x));
        channel.labels.forEach((rect, edge) => frameLabels.set(edge, rect));
        columnX[layer + 1] = start + channel.width;
    }

    const frameBoxOf = (unit: number): Rect => ({ x: unitX[unit]!, y: top[unit]!, w: units[unit]!.w, h: units[unit]!.h });
    const shapeOf = (unit: number): DiagramShape | undefined => document.nodes[units[unit]!.node]!.shape;
    const exitX = (unit: number, y: number): number => {
        const self = units[unit]!;
        if (self.node < 0) {
            return columnX[self.layer]! + columnWidth[self.layer]!;
        }
        const box = frameBoxOf(unit);
        return box.x + box.w - insetOf(shapeOf(unit), box, y - centerOf(unit), down);
    };
    const entryX = (unit: number, y: number): number => {
        const self = units[unit]!;
        if (self.node < 0) {
            return columnX[self.layer]!;
        }
        const box = frameBoxOf(unit);
        return box.x + insetOf(shapeOf(unit), box, y - centerOf(unit), down);
    };
    const toReal = (point: Point): Point => (down ? flipPoint(point) : point);
    const labelOf = (edge: number, frame: Rect | undefined): EdgeLabelBox | null => {
        const size = labelSizes[edge];
        if (!size || !frame) {
            return null;
        }
        return { ...(down ? flip(frame) : frame), lines: size.lines };
    };

    const nodes: NodeBox[] = document.nodes.map((node, index) => {
        const size = sizes[index]!;
        const unit = unitOfNode.get(index);
        if (unit === undefined) {
            const [px, py] = node.pos!;
            return {
                id: node.id,
                x: Math.round(px),
                y: Math.round(py),
                w: size.w,
                h: size.h,
                layer: layers.get(node.id) ?? 0,
                pinned: true,
                label: size.label,
                sub: size.sub
            };
        }
        const frame = frameBoxOf(unit);
        const box = down ? flip(frame) : frame;
        return { id: node.id, ...box, layer: units[unit]!.layer, pinned: false, label: size.label, sub: size.sub };
    });
    const byId = new Map(nodes.map((box) => [box.id, box]));

    const routes: (EdgeRoute | undefined)[] = [];
    const unplaced = new Set<number>(loose);
    for (const chain of chains) {
        const points: Point[] = [];
        for (const index of chain.hops) {
            const hop = hops[index]!;
            const ya = hopStart[index]!;
            const yb = hopEnd[index]!;
            points.push({ x: exitX(hop.from, ya), y: ya });
            if (ya !== yb) {
                const x = trackX.get(index)!;
                points.push({ x, y: ya }, { x, y: yb });
            }
            points.push({ x: entryX(hop.to, yb), y: yb });
        }
        const ordered = chain.reversed ? simplify(points).reverse() : simplify(points);
        const edge = document.edges[chain.edge]!;
        routes[chain.edge] = {
            index: chain.edge,
            from: edge.from,
            to: edge.to,
            points: ordered.map(toReal),
            label: labelOf(chain.edge, frameLabels.get(chain.edge))
        };
    }
    loops.forEach((loop, index) => {
        const box = frameBoxOf(loop.unit);
        const reach = box.x + box.w + LOOP;
        const startY = loopStart[index]!;
        const endY = loopEnd[index]!;
        const points = [
            { x: exitX(loop.unit, startY), y: startY },
            { x: reach, y: startY },
            { x: reach, y: endY },
            { x: exitX(loop.unit, endY), y: endY }
        ];
        if (!frameLabels.has(loop.edge)) {
            unplaced.add(loop.edge);
        }
        const size = labelSizes[loop.edge];
        // In the last layer there is no channel to put a label in, so it sits beside the loop.
        const frame =
            frameLabels.get(loop.edge) ??
            (size
                ? {
                      x: reach + 6,
                      y: Math.round((startY + endY) / 2) - Math.floor((down ? size.w : size.h) / 2),
                      w: down ? size.h : size.w,
                      h: down ? size.w : size.h
                  }
                : undefined);
        const edge = document.edges[loop.edge]!;
        routes[loop.edge] = { index: loop.edge, from: edge.from, to: edge.to, points: points.map(toReal), label: labelOf(loop.edge, frame) };
    });
    for (const index of loose) {
        const edge = document.edges[index]!;
        const source = byId.get(edge.from)!;
        const target = byId.get(edge.to)!;
        const points = looseRoute(source, target, edge.from === edge.to, down);
        const size = labelSizes[index];
        let label: EdgeLabelBox | null = null;
        if (size) {
            const at = Math.max(0, Math.floor((points.length - 2) / 2));
            const first = points[at]!;
            const second = points[at + 1] ?? first;
            const middle = { x: Math.round((first.x + second.x) / 2), y: Math.round((first.y + second.y) / 2) };
            label = { x: middle.x - size.w / 2, y: middle.y - size.h - 4, w: size.w, h: size.h, lines: size.lines };
        }
        routes[index] = { index, from: edge.from, to: edge.to, points, label };
    }
    const edges = routes.filter((route): route is EdgeRoute => route !== undefined);

    const alongAfter = GROUP_PADDING;
    const groups: GroupBox[] = document.groups.flatMap((group, groupIndex) => {
        const rects: Rect[] = [];
        const bandIndex = bandOfGroup.get(groupIndex);
        if (bandIndex !== undefined) {
            const band = bands[bandIndex]!;
            const members = band.members.flat().filter((unit) => units[unit]!.node >= 0);
            const alongStart = bandAlongStart(band);
            const alongEnd = Math.max(...members.map((unit) => unitX[unit]! + units[unit]!.w)) + alongAfter;
            const frame = { x: alongStart, y: band.top, w: alongEnd - alongStart, h: band.height };
            rects.push(down ? flip(frame) : frame);
        }
        for (const id of group.wraps) {
            const box = byId.get(id);
            if (box?.pinned) {
                rects.push({
                    x: box.x - GROUP_PADDING,
                    y: box.y - GROUP_PADDING - GROUP_LABEL_BAND,
                    w: box.w + GROUP_PADDING * 2,
                    h: box.h + GROUP_PADDING * 2 + GROUP_LABEL_BAND
                });
            }
        }
        if (rects.length === 0) {
            return [];
        }
        const rect = unionOf(rects)!;
        const labelBox = { x: rect.x + GROUP_LABEL_INSET, y: rect.y + 4, w: estimateTextWidth(group.label, SUB_SIZE, true), h: SUB_LINE };
        return [{ id: group.id, ...rect, labelBox }];
    });

    // A label that no channel placed (a loop in the last layer, an edge with a pinned end) moves down until it is clear.
    const settled = edges.flatMap((edge) => (edge.label && !unplaced.has(edge.index) ? [edge.label] : []));
    for (const edge of edges) {
        const label = edge.label;
        if (!label || !unplaced.has(edge.index)) {
            continue;
        }
        const taken = (): boolean =>
            [...nodes, ...groups.map((group) => group.labelBox)].some((box) => overlapsRect(box, label)) ||
            settled.some((other) => overlapsRect({ x: other.x - 4, y: other.y - 4, w: other.w + 8, h: other.h + 8 }, label));
        for (let step = 0; step < 1000 && taken(); step++) {
            label.y += 4;
        }
        settled.push(label);
    }
    const corners = edges.flatMap((edge) => edge.points.map((point) => ({ ...point, w: 0, h: 0 })));
    const labels = edges.flatMap((edge) => (edge.label ? [edge.label] : []));
    const groupLabels = groups.map((group) => group.labelBox);
    return { nodes, groups, edges, bounds: unionOf([...nodes, ...groups, ...groupLabels, ...corners, ...labels]) ?? { x: 0, y: 0, w: 0, h: 0 } };
};
