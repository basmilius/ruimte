import type { ResizeEdge } from '@/canvas-model/derived-frame';
import { containsPoint, type Point, type Rect } from '@/canvas-model/math';
import { HINT_HOT, HINT_REACH } from '@/canvas/port-hints';

/* Screen pixels: a handle keeps its size at every zoom, the way a port does. */
const PILL = 36;
const PILL_MIN = 12;
export const RESIZE_CORNER = 22;
/* Half the span along an edge that belongs to the port in its middle. */
const PORT_CLEAR = 14;
/* Over how much past that the pill fades in. */
const PORT_FADE = 12;
/* How far out the pill sits, the middle of the band a press takes. */
const OUT = HINT_HOT / 2;

type ResizeSide = 'n' | 's' | 'e' | 'w';

export interface ResizeHandle {
    nodeId: string;
    edge: ResizeEdge;
    /* The middle of the pill, or the corner itself, in world units. */
    at: Point;
    /* Of the pill along its edge in world units; 0 for a corner. */
    length: number;
    /* 0 where it fades in, 1 with the pointer close enough to aim at it. */
    strength: number;
    hot: boolean;
}

export interface ResizeCandidate extends Rect {
    id: string;
    /* A group is a frame under its nodes: a pointer inside one is still out on the canvas. */
    group: boolean;
    /* Its z-index (`canvas/stacking.ts`); a card beside a node shares its owner's. */
    stack: number;
    selected: boolean;
    /* The only edges it offers; every edge when absent. */
    edges?: readonly ResizeEdge[];
}

/*
 * The handle a pointer at `point` brings up: on the nearest node within reach, and only while the
 * pointer is outside every node that lies above it, so the content on top keeps every pixel of its
 * own. The band of a selected node wins over any body: the person picked that node to work on.
 */
export function resizeHandle(nodes: readonly ResizeCandidate[], point: Point, zoom: number): ResizeHandle | null {
    const under = nodes.filter((node) => !node.group && containsPoint(node, point));
    const reach = HINT_REACH / zoom;
    let nearest: { node: ResizeCandidate; distance: number } | null = null;
    for (const node of nodes) {
        if (containsPoint(node, point) || (!node.selected && under.some((over) => over.stack > node.stack))) {
            continue;
        }
        const distance = distanceTo(node, point);
        if (distance <= reach && (nearest === null || distance < nearest.distance)) {
            nearest = { node, distance };
        }
    }
    if (nearest === null) {
        return null;
    }
    const handle = handleOn(nearest.node, nearest.distance, point, zoom);
    return handle === null || nearest.node.edges === undefined || nearest.node.edges.includes(handle.edge) ? handle : null;
}

function handleOn(node: ResizeCandidate, distance: number, point: Point, zoom: number): ResizeHandle | null {
    const reach = HINT_REACH / zoom;
    const strength = Math.min(1, (reach - distance) / (reach / 2));
    const near = distance * zoom <= HINT_HOT;
    const outX = point.x < node.x ? -1 : point.x > node.x + node.w ? 1 : 0;
    const outY = point.y < node.y ? -1 : point.y > node.y + node.h ? 1 : 0;
    if (outX !== 0 && outY !== 0) {
        return cornerHandle(node, cornerOf(outY < 0 ? 'n' : 's', outX < 0 ? 'w' : 'e'), strength, near);
    }
    const side: ResizeSide = outY < 0 ? 'n' : outY > 0 ? 's' : outX < 0 ? 'w' : 'e';
    const offers = (edge: ResizeEdge): boolean => node.edges === undefined || node.edges.includes(edge);
    return sideHandle(node, side, point, zoom, strength, near, false, offers);
}

/* The handle under a resize that is running: on the edge it started from, following the pointer. */
export function heldHandle(node: Rect & { id: string }, edge: ResizeEdge, point: Point, zoom: number): ResizeHandle {
    if (edge.length === 2) {
        return cornerHandle(node, edge, 1, true);
    }
    return sideHandle(node, edge as ResizeSide, point, zoom, 1, true, true)!;
}

/* The frame's own rounding, `rounded-xl` in `NodeFrame.tsx`, in world units since the frame scales with the zoom. */
const NODE_RADIUS = 12;
/* Screen pixels a corner runs on along each edge past its bend. */
const CORNER_ARM = 6;

/* A handle as a stretch of the rail: a rounded rectangle at the pill's distance around the frame. */
export interface HandleRail {
    /* Clockwise, starting halfway down the left side, where a port and never a free handle sits. */
    path: string;
    perimeter: number;
    /* Where the handle starts along the rail, and how far it runs, in world units. */
    from: number;
    length: number;
}

/*
 * Where a handle runs on the rail around its node. A pill and a corner are both a stretch of the same
 * rail, so one that glides into the other follows the frame round and never cuts through the node.
 */
export function handleRail(frame: Rect, handle: ResizeHandle, zoom: number): HandleRail {
    const out = OUT / zoom;
    const x = frame.x - out;
    const y = frame.y - out;
    const width = frame.w + 2 * out;
    const height = frame.h + 2 * out;
    const radius = Math.min(NODE_RADIUS + out, width / 2, height / 2);
    const quarter = (Math.PI * radius) / 2;
    const across = width - 2 * radius;
    const down = height - 2 * radius;
    const upperLeft = height / 2 - radius;
    const top = upperLeft + quarter;
    const right = top + across + quarter;
    const bottom = right + down + quarter;
    const lowerLeft = bottom + across + quarter;
    const perimeter = lowerLeft + upperLeft;
    const path = [
        `M ${x} ${y + height / 2}`,
        `L ${x} ${y + radius}`,
        `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
        `L ${x + width - radius} ${y}`,
        `A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius}`,
        `L ${x + width} ${y + height - radius}`,
        `A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + height}`,
        `L ${x + radius} ${y + height}`,
        `A ${radius} ${radius} 0 0 1 ${x} ${y + height - radius}`,
        'Z'
    ].join(' ');
    const { at } = handle;
    let middle: number;
    switch (handle.edge) {
        case 'n':
            middle = top + at.x - (x + radius);
            break;
        case 'e':
            middle = right + at.y - (y + radius);
            break;
        case 's':
            middle = bottom + x + width - radius - at.x;
            break;
        case 'w':
            middle = at.y > y + height / 2 ? lowerLeft + y + height - radius - at.y : y + height / 2 - at.y;
            break;
        case 'nw':
            middle = upperLeft + quarter / 2;
            break;
        case 'ne':
            middle = top + across + quarter / 2;
            break;
        case 'se':
            middle = right + down + quarter / 2;
            break;
        case 'sw':
            middle = bottom + across + quarter / 2;
            break;
    }
    const length = handle.edge.length === 2 ? quarter + (2 * CORNER_ARM) / zoom : handle.length;
    return { path, perimeter, from: (middle - length / 2 + perimeter) % perimeter, length };
}

function sideHandle(
    node: Rect & { id: string },
    side: ResizeSide,
    point: Point,
    zoom: number,
    strength: number,
    near: boolean,
    held = false,
    offers: (edge: ResizeEdge) => boolean = () => true
): ResizeHandle | null {
    const horizontal = side === 'n' || side === 's';
    const length = (horizontal ? node.w : node.h) * zoom;
    const along = (horizontal ? point.x - node.x : point.y - node.y) * zoom;
    const pill = Math.min(PILL, length / 2 - PORT_CLEAR - RESIZE_CORNER);
    const startCorner = horizontal ? cornerOf(side, 'w') : cornerOf('n', side);
    const endCorner = horizontal ? cornerOf(side, 'e') : cornerOf('s', side);
    // A card that offers an edge without its corners keeps the pill on it, at an end and on a short edge too.
    const bendsAtStart = !held && offers(startCorner);
    const bendsAtEnd = !held && offers(endCorner);
    if (pill < PILL_MIN) {
        if (bendsAtStart && (along < length / 2 || !bendsAtEnd)) {
            return cornerHandle(node, startCorner, strength, near);
        }
        if (bendsAtEnd) {
            return cornerHandle(node, endCorner, strength, near);
        }
        return { ...pillAt(node, side, length / 2, PILL_MIN, zoom), strength, hot: near };
    }
    if (bendsAtStart && along < RESIZE_CORNER) {
        return cornerHandle(node, startCorner, strength, near);
    }
    if (bendsAtEnd && along > length - RESIZE_CORNER) {
        return cornerHandle(node, endCorner, strength, near);
    }
    const port = length / 2;
    // The middle of an edge is the port's: the pill stops beside it and fades out as the pointer goes on to it.
    const fade = held ? 1 : Math.min(1, Math.max(0, (Math.abs(along - port) - PORT_CLEAR) / PORT_FADE));
    if (fade === 0) {
        return null;
    }
    let middle = Math.max(RESIZE_CORNER + pill / 2, Math.min(length - RESIZE_CORNER - pill / 2, along));
    if (!held && Math.abs(middle - port) < PORT_CLEAR + pill / 2) {
        middle = middle < port ? port - PORT_CLEAR - pill / 2 : port + PORT_CLEAR + pill / 2;
    }
    const onPill = Math.abs(along - middle) <= pill / 2;
    return { ...pillAt(node, side, middle, pill, zoom), strength: strength * fade, hot: near && (held || (onPill && fade === 1)) };
}

function pillAt(node: Rect & { id: string }, side: ResizeSide, middle: number, pill: number, zoom: number): Omit<ResizeHandle, 'strength' | 'hot'> {
    const out = OUT / zoom;
    const at =
        side === 'n'
            ? { x: node.x + middle / zoom, y: node.y - out }
            : side === 's'
              ? { x: node.x + middle / zoom, y: node.y + node.h + out }
              : side === 'w'
                ? { x: node.x - out, y: node.y + middle / zoom }
                : { x: node.x + node.w + out, y: node.y + middle / zoom };
    return { nodeId: node.id, edge: side, at, length: pill / zoom };
}

function cornerHandle(node: Rect & { id: string }, edge: ResizeEdge, strength: number, hot: boolean): ResizeHandle {
    const at = { x: edge.includes('w') ? node.x : node.x + node.w, y: edge.includes('n') ? node.y : node.y + node.h };
    return { nodeId: node.id, edge, at, length: 0, strength, hot };
}

function cornerOf(vertical: 'n' | 's', horizontal: 'w' | 'e'): ResizeEdge {
    return `${vertical}${horizontal}`;
}

function distanceTo(rect: Rect, point: Point): number {
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
    const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
    return Math.hypot(dx, dy);
}
