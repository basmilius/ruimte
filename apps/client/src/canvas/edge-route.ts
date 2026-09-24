import type { NodeSide } from '@ruimte/contracts';
import { centerOf } from '@ruimte/drawing';
import type { Point, Rect } from '@/canvas/math';

/* The edge of a node a connector leaves from or lands on. */
export type Side = NodeSide;

/* The sides a line is held to, because a person drew it from that port. An end left out is free. */
export interface FixedSides {
    fromSide?: Side;
    toSide?: Side;
}

/* Air between a node and the connector that touches it: the line stops short of the border and its
   dot sits in the gap, so a port reads as something beside the node instead of drawn onto it. */
export const NODE_GAP = 9;

/*
 * The straight piece a line keeps at either end, so it always leaves square to the side it is on.
 * It is the smallest step a route makes as well: a turn any nearer to a port reads as a kink in the
 * line rather than as a way around something.
 */
const STUB = 24;

/* The radius of the bend where two legs of a route meet. */
const CORNER = 15;

/* How far a route stands off a node it passes, on top of the gap it keeps at its own ends. */
const OBSTACLE_MARGIN = 12;

/* What a turn costs the search, in world units of line it has to save to be worth taking. */
const BEND_COST = 60;

/* A leg passing a node it does not belong to closer than this threads a gap rather than going round. */
const TIGHT = 40;

/* What threading such a gap costs, weighed against going round: more than a bend, less than a detour. */
const TIGHT_COST = 300;

/* How far past the two ends a route may wander to get around something. */
const DETOUR_ROOM = 240;

/* Pairs of sides the search takes on, the nearest first: every pair costs a search of its own. */
const SEARCHED_PAIRS = 4;

/* Lanes per axis the search takes on. A canvas past this has more to lose from a slow drag than from
   a line that runs behind a node, which it is drawn under anyway. */
const LANE_LIMIT = 48;

/* A node a route has to stay clear of, by the id of the node it stands for. */
export interface Obstacle extends Rect {
    id: string;
}

export interface EdgeRoute {
    /* The line itself, as the `d` of a path. */
    d: string;
    /* Where the dots go: a gap out from the sides the line leaves and lands on. */
    from: Point;
    to: Point;
    /* The sides it settled on, which is what tells a node which of its ports is spoken for. */
    fromSide: Side;
    toSide: Side;
    /* Halfway along the route, which is what a label and the button that removes it ride on. */
    mid: Point;
}

/* A node as the route sees it: the box it may not enter, margin included. */
interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/* Which way a side faces, away from the node: what pushes a port out of it and what a marker there points along. */
export const SIDE_NORMAL: Record<Side, Point> = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
};

const isVertical = (side: Side): boolean => side === 'top' || side === 'bottom';

const push = (point: Point, side: Side, distance: number): Point => ({
    x: point.x + SIDE_NORMAL[side].x * distance,
    y: point.y + SIDE_NORMAL[side].y * distance
});

const grow = (rect: Rect, margin: number): Bounds => ({
    minX: rect.x - margin,
    minY: rect.y - margin,
    maxX: rect.x + rect.w + margin,
    maxY: rect.y + rect.h + margin
});

/* The middle of a side, which is where a connector meets the node itself. */
export const sidePoint = (rect: Rect, side: Side): Point =>
    isVertical(side)
        ? { x: rect.x + rect.w / 2, y: side === 'top' ? rect.y : rect.y + rect.h }
        : { x: side === 'left' ? rect.x : rect.x + rect.w, y: rect.y + rect.h / 2 };

/* Where the dot of a connector on this side sits: the gap out from the node. */
export const portPoint = (rect: Rect, side: Side): Point => push(sidePoint(rect, side), side, NODE_GAP);

/*
 * The route between two nodes: out of a side, around whatever lies between, into the facing one.
 *
 * The facing sides come first and are kept the moment they work, since that is the line a person
 * would draw. Only when something is in the way do the other sides of the two nodes get a turn: a
 * line that has to go around a node reads better leaving over the top than squeezing past its side.
 */
export const routeEdge = (a: Rect, b: Rect, obstacles: readonly Obstacle[] = [], fixed: FixedSides = {}): EdgeRoute =>
    route({ rect: a, gap: NODE_GAP }, { rect: b, gap: NODE_GAP }, obstacles, fixed);

/*
 * A line being drawn: it leaves its node the way a finished one does and ends under the pointer,
 * which is the one endpoint that keeps no gap. A node under the pointer is where the line is about
 * to land, so it is no longer in the way.
 */
export const routeDraft = (a: Rect, point: Point, obstacles: readonly Obstacle[] = [], fixed: FixedSides = {}): EdgeRoute => {
    const end = outsideOf(grow(a, NODE_GAP), point);
    return route(
        { rect: a, gap: NODE_GAP },
        { rect: { x: end.x, y: end.y, w: 0, h: 0 }, gap: 0 },
        obstacles.filter((obstacle) => !contains(obstacle, end)),
        fixed
    );
};

/* The point itself, or where it leaves the box the nearest way: a line has no way to a pointer over its own node. */
const outsideOf = (box: Bounds, point: Point): Point => {
    if (point.x <= box.minX || point.x >= box.maxX || point.y <= box.minY || point.y >= box.maxY) {
        return point;
    }
    const exits: Point[] = [
        { x: box.minX, y: point.y },
        { x: box.maxX, y: point.y },
        { x: point.x, y: box.minY },
        { x: point.x, y: box.maxY }
    ];
    return exits.reduce((nearest, exit) =>
        Math.hypot(exit.x - point.x, exit.y - point.y) < Math.hypot(nearest.x - point.x, nearest.y - point.y) ? exit : nearest
    );
};

/* One end of a route: the box it belongs to, and how far out from its border the line stops. */
interface End {
    rect: Rect;
    gap: number;
}

const endPoint = (end: End, side: Side): Point => push(sidePoint(end.rect, side), side, end.gap);

const route = (a: End, b: End, obstacles: readonly Obstacle[], fixed: FixedSides): EdgeRoute => {
    const blocked = obstacles.map((obstacle) => grow(obstacle, OBSTACLE_MARGIN));
    /* The two nodes the line belongs to are in the way as much as any other: a route that leaves one
       side and comes back over the node it just left is no route. They keep the gap as their margin,
       so a leg may still run right beside the node it starts from. */
    const own = [grow(a.rect, a.gap), grow(b.rect, b.gap)];
    const candidates = sideCandidates(a.rect, b.rect, fixed);
    /* A canvas with no way through the others still gets a line that stays out from under its own
       two nodes; it tucks in behind the rest, which it is drawn under anyway. */
    const best = search(a, b, candidates, blocked, own) ?? search(a, b, candidates, [], own);
    if (best !== null) {
        return pathThrough(best.points, best.sides);
    }
    // Nothing works, not even around the two nodes themselves: the line it would have drawn anyway.
    return pathThrough(plainRoute(a, b, candidates[0]!, blocked), candidates[0]!);
};

/* The cheapest route between the two ends that keeps clear of every node, or `null` when there is none. */
const search = (a: End, b: End, candidates: readonly SidePair[], blocked: readonly Bounds[], own: readonly Bounds[]): Attempt | null => {
    const closed = [...blocked, ...own];
    const facing = candidates[0]!;
    const direct = plainRoute(a, b, facing, closed);
    // The plain line between the sides the two nodes face, which nothing has to beat when it is clear.
    if (fits(direct, facing, closed) && !detours(direct, blocked)) {
        return { points: direct, sides: facing, cost: 0 };
    }

    let best: Attempt | null = null;
    for (const sides of candidates) {
        const points = plainRoute(a, b, sides, closed);
        if (fits(points, sides, closed)) {
            best = cheaper(best, points, sides, blocked);
        }
    }
    if (best === null || detours(best.points, blocked)) {
        /* The search gets a turn now: a line that has to go round reads better leaving over the top
           than coming back down to squeeze into the side it faces. Only the pairs whose ports lie
           nearest, since each one costs a search of its own. */
        for (const sides of nearestPairs(a, b, candidates)) {
            const points = routeAround(endPoint(a, sides[0]), sides[0], endPoint(b, sides[1]), sides[1], closed);
            if (points !== null) {
                best = cheaper(best, points, sides, blocked);
            }
        }
    }
    return best;
};

/* A plain route that keeps clear of every node, and turns nowhere inside the piece either end keeps straight. */
const fits = (points: readonly Point[], [fromSide, toSide]: SidePair, closed: readonly Bounds[]): boolean => {
    if (!isClear(points, closed)) {
        return false;
    }
    const from = points[0]!;
    const to = points[points.length - 1]!;
    // Ends on the same axis meet in a channel, whose rail may sit in a gap narrower than two stubs but never behind a port.
    if (isVertical(fromSide) === isVertical(toSide)) {
        return outFrom(from, fromSide, points[1]!) > 0 && outFrom(to, toSide, points[points.length - 2]!) > 0;
    }
    return outFrom(from, fromSide, points[1]!) >= STUB && outFrom(to, toSide, points[1]!) >= STUB;
};

/* How far a point lies out from a port, along the way its side faces: negative is behind it. */
const outFrom = (port: Point, side: Side, point: Point): number => (point.x - port.x) * SIDE_NORMAL[side].x + (point.y - port.y) * SIDE_NORMAL[side].y;

const contains = (rect: Rect, point: Point): boolean => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

/* Whether a route had to work for it: it turns more than a channel does, or it passes a node close by. */
const detours = (points: readonly Point[], blocked: readonly Bounds[]): boolean => {
    const straightened = straighten(points);
    return straightened.length > 4 || tight(straightened, blocked) > 0;
};

/* A route under consideration, by what it costs to read: the line itself plus every turn in it. */
interface Attempt {
    points: Point[];
    sides: SidePair;
    cost: number;
}

type SidePair = readonly [Side, Side];

const cheaper = (best: Attempt | null, points: Point[], sides: SidePair, blocked: readonly Bounds[]): Attempt => {
    const straightened = straighten(points);
    const legs = straightened.slice(1).map((point, index) => Math.hypot(point.x - straightened[index]!.x, point.y - straightened[index]!.y));
    const cost = legs.reduce((total, length) => total + length, 0) + (straightened.length - 2) * BEND_COST + tight(straightened, blocked) * TIGHT_COST;
    return best !== null && best.cost <= cost ? best : { points, sides, cost };
};

/*
 * The legs that pass a node they do not belong to closer than a gap a person would call room. A line
 * threading between two nodes reads worse than one going round them, however much shorter it is.
 */
const tight = (points: readonly Point[], blocked: readonly Bounds[]): number => {
    let count = 0;
    for (let index = 1; index < points.length; index++) {
        const from = points[index - 1]!;
        const to = points[index]!;
        const vertical = Math.abs(to.x - from.x) < Math.abs(to.y - from.y);
        const low = vertical ? Math.min(from.y, to.y) : Math.min(from.x, to.x);
        const high = vertical ? Math.max(from.y, to.y) : Math.max(from.x, to.x);
        const beside = vertical ? from.x : from.y;
        const near = blocked.some((box) => {
            const [alongMin, alongMax] = vertical ? [box.minY, box.maxY] : [box.minX, box.maxX];
            const [besideMin, besideMax] = vertical ? [box.minX, box.maxX] : [box.minY, box.maxY];
            if (alongMax <= low || alongMin >= high) {
                return false;
            }
            const room = beside < besideMin ? besideMin - beside : beside > besideMax ? beside - besideMax : 0;
            return room > 0 && room < TIGHT;
        });
        if (near) {
            count++;
        }
    }
    return count;
};

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/*
 * The pairs of sides a line may run between, the pair the two boxes face first. Each node offers the
 * side it faces the other with and both sides of the other axis: a line that has to go round a row of
 * nodes leaves over the top of it, whichever way the two happen to lie.
 */
const sideCandidates = (a: Rect, b: Rect, fixed: FixedSides = {}): readonly SidePair[] => {
    const from = centerOf(a);
    const to = centerOf(b);
    const across: SidePair = to.x >= from.x ? ['right', 'left'] : ['left', 'right'];
    const down: SidePair = to.y >= from.y ? ['bottom', 'top'] : ['top', 'bottom'];
    const [facing, other] = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? [across, down] : [down, across];
    // A port a person drew from is the only side that end gets, wherever the two nodes end up.
    const fromSides: readonly Side[] = fixed.fromSide ? [fixed.fromSide] : [facing[0], other[0], OPPOSITE[other[0]]];
    const toSides: readonly Side[] = fixed.toSide ? [fixed.toSide] : [facing[1], other[1], OPPOSITE[other[1]]];
    return fromSides.flatMap((fromSide) => toSides.map((toSide): SidePair => [fromSide, toSide]));
};

/* The pairs whose two ports lie closest, which is as much of the list as the search can pay for. */
const nearestPairs = (a: End, b: End, candidates: readonly SidePair[]): readonly SidePair[] =>
    [...candidates].sort((one, other) => reach(a, b, one) - reach(a, b, other)).slice(0, SEARCHED_PAIRS);

const reach = (a: End, b: End, [fromSide, toSide]: SidePair): number => {
    const from = endPoint(a, fromSide);
    const to = endPoint(b, toSide);
    return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
};

const plainRoute = (a: End, b: End, [fromSide, toSide]: SidePair, blocked: readonly Bounds[]): Point[] => {
    const from = endPoint(a, fromSide);
    const to = endPoint(b, toSide);
    return [from, ...between(from, fromSide, to, toSide, blocked), to];
};

/* The turns between two endpoints: a channel when they face the same axis, one corner when they do not. */
const between = (from: Point, fromSide: Side, to: Point, toSide: Side, blocked: readonly Bounds[]): Point[] => {
    const fromStub = push(from, fromSide, STUB);
    const toStub = push(to, toSide, STUB);
    // Two ports straight across from each other: the line between them is the route, however short.
    const lined = isVertical(fromSide) ? Math.abs(from.x - to.x) < 1 : Math.abs(from.y - to.y) < 1;
    if (lined && toSide === OPPOSITE[fromSide] && outFrom(from, fromSide, to) > 0 && !blocked.some((box) => crosses(from, to, box))) {
        return [];
    }
    if (isVertical(fromSide) === isVertical(toSide)) {
        return channel(fromStub, toStub, blocked, isVertical(fromSide), railWindow([fromStub, fromSide], [toStub, toSide]));
    }
    return [isVertical(fromSide) ? { x: fromStub.x, y: toStub.y } : { x: toStub.x, y: fromStub.y }];
};

/*
 * Where the rail of a channel may run: past the stub of either end, never between a port and its
 * stub. Two ends leaving the same way have their window on the far side of both, which is what makes
 * a line over a row of nodes step clear of them instead of grazing their tops.
 */
const railWindow = (...ends: readonly (readonly [Point, Side])[]): Window => {
    let min = -Infinity;
    let max = Infinity;
    for (const [stub, side] of ends) {
        const rail = isVertical(side) ? stub.y : stub.x;
        if (side === 'bottom' || side === 'right') {
            min = Math.max(min, rail);
        } else {
            max = Math.min(max, rail);
        }
    }
    return { min, max };
};

/* The rails a channel may pick from, which is empty for two nodes with no room between them. */
interface Window {
    min: number;
    max: number;
}

/*
 * A connector onto its own node leaves the right side low and comes back in high, so the loop reads
 * as a run back into the node rather than as a line doubling over itself.
 */
export const selfRoute = (rect: Rect): EdgeRoute => {
    const x = rect.x + rect.w + NODE_GAP;
    const from = { x, y: rect.y + (rect.h / 4) * 3 };
    const to = { x, y: rect.y + rect.h / 4 };
    const out = x + STUB * 2;
    return pathThrough([from, { x: out, y: from.y }, { x: out, y: to.y }, to], ['right', 'right']);
};

const pathThrough = (raw: readonly Point[], [fromSide, toSide]: SidePair): EdgeRoute => {
    const points = straighten(raw);
    return {
        d: roundedPath(points, CORNER),
        from: points[0]!,
        to: points[points.length - 1]!,
        fromSide,
        toSide,
        mid: halfway(points)
    };
};

/*
 * The two turns of a route whose ends face the same axis: out to a rail between them, along it, and
 * back in. The rail slides off the middle when a node sits in the way. Ends that already line up
 * have no rail to slide, so that run only steps aside for what blocks the straight shot.
 */
const channel = (from: Point, to: Point, blocked: readonly Bounds[], vertical: boolean, window: Window): Point[] => {
    // The lane is the coordinate a leg keeps as it travels; the rail is the one the turns share.
    const laneOf = (point: Point): number => (vertical ? point.x : point.y);
    const railOf = (point: Point): number => (vertical ? point.y : point.x);
    const at = (lane: number, rail: number): Point => (vertical ? { x: lane, y: rail } : { x: rail, y: lane });

    if (Math.abs(laneOf(from) - laneOf(to)) < 1) {
        const blocking = blocked.filter((box) => crosses(from, to, box));
        if (blocking.length === 0) {
            return [];
        }
        /* The stubs are turns of their own here: the way around leaves the lane the ends share, so
           without them the first leg would cut across from the port to the corner. */
        const lane = sidestep(laneOf(from), blocking, vertical);
        return [from, at(lane, railOf(from)), at(lane, railOf(to)), to];
    }

    const rail = clearRail((railOf(from) + railOf(to)) / 2, from, to, blocked, vertical, window);
    return [at(laneOf(from), rail), at(laneOf(to), rail)];
};

/* The rail nearest the middle that keeps all three legs clear, trying the far side of every node in the way. */
const clearRail = (middle: number, from: Point, to: Point, blocked: readonly Bounds[], vertical: boolean, window: Window): number => {
    const clear = (rail: number): boolean => {
        const turn = vertical ? { x: from.x, y: rail } : { x: rail, y: from.y };
        const back = vertical ? { x: to.x, y: rail } : { x: rail, y: to.y };
        return !blocked.some((box) => crosses(from, turn, box) || crosses(turn, back, box) || crosses(back, to, box));
    };
    // The middle of the two ends, kept out of the piece either one keeps straight.
    const preferred = window.min > window.max ? middle : Math.min(Math.max(middle, window.min), window.max);
    if (clear(preferred)) {
        return preferred;
    }
    const candidates = [
        ...blocked.flatMap((box) => (vertical ? [box.minY, box.maxY] : [box.minX, box.maxX])),
        ...[window.min, window.max].filter((edge) => Number.isFinite(edge))
    ]
        .filter((rail) => window.min > window.max || (rail >= window.min && rail <= window.max))
        .sort((one, other) => Math.abs(one - preferred) - Math.abs(other - preferred));
    return candidates.find(clear) ?? preferred;
};

/* The nearer side to pass a bundle of blocking nodes on, a step clear of the lane the two ends share. */
const sidestep = (lane: number, blocking: readonly Bounds[], vertical: boolean): number => {
    const near = Math.min(...blocking.map((box) => (vertical ? box.minX : box.minY)));
    const far = Math.max(...blocking.map((box) => (vertical ? box.maxX : box.maxY)));
    const step = lane - near <= far - lane ? near : far;
    return Math.abs(step - lane) >= STUB ? step : lane + (step < lane ? -STUB : STUB);
};

/*
 * The way around every node, found on the lanes the nodes themselves draw: the edges of each box and
 * the coordinates of the two ends. Every turn costs, so the route it settles on is the one with the
 * fewest bends among the short ones. `null` when there is no way through, or when the canvas is too
 * busy to look for one.
 */
const routeAround = (from: Point, fromSide: Side, to: Point, toSide: Side, blocked: readonly Bounds[]): Point[] | null => {
    const start = push(from, fromSide, STUB);
    const goal = push(to, toSide, STUB);
    /* The room the route gets. What lies further out than this is not worth going round, and leaving
       it out of the lanes is what keeps a busy canvas from searching a lattice of everything. */
    const area: Bounds = {
        minX: Math.min(from.x, to.x) - DETOUR_ROOM,
        minY: Math.min(from.y, to.y) - DETOUR_ROOM,
        maxX: Math.max(from.x, to.x) + DETOUR_ROOM,
        maxY: Math.max(from.y, to.y) + DETOUR_ROOM
    };
    const near = blocked.filter((box) => box.minX < area.maxX && box.maxX > area.minX && box.minY < area.maxY && box.maxY > area.minY);
    /* No turn inside a stub: the piece a line keeps straight out of a port is not a place to bend,
       or a route leaves the port and doubles back on itself a few units later. */
    const stubs = [
        [isVertical(fromSide), from, start],
        [isVertical(toSide), to, goal]
    ] as const;
    const outside = (lane: number, horizontal: boolean): boolean =>
        stubs.every(([vertical, port, stub]) => {
            if (vertical === horizontal) {
                return true;
            }
            const [low, high] = vertical ? [port.y, stub.y] : [port.x, stub.x];
            return lane <= Math.min(low, high) || lane >= Math.max(low, high);
        });
    const xs = lanes([from.x, start.x, goal.x, to.x, area.minX, area.maxX], near, true, area.minX, area.maxX).filter((lane) => outside(lane, true));
    const ys = lanes([from.y, start.y, goal.y, to.y, area.minY, area.maxY], near, false, area.minY, area.maxY).filter((lane) => outside(lane, false));
    if (xs.length > LANE_LIMIT || ys.length > LANE_LIMIT) {
        return null;
    }

    const height = ys.length;
    const vertexAt = (point: Point): number => xs.indexOf(point.x) * height + ys.indexOf(point.y);
    const pointAt = (vertex: number): Point => ({ x: xs[Math.floor(vertex / height)]!, y: ys[vertex % height]! });
    // A stub that ends inside the other one has no lane to start or finish on.
    if (!xs.includes(start.x) || !ys.includes(start.y) || !xs.includes(goal.x) || !ys.includes(goal.y)) {
        return null;
    }
    const startVertex = vertexAt(start);
    const goalVertex = vertexAt(goal);
    const fromNormal = SIDE_NORMAL[fromSide];
    const toNormal = SIDE_NORMAL[toSide];

    /* A state is a vertex reached along an axis, so a route that has to turn to carry on pays for it
       here and not once for the whole vertex. */
    const axisOf = (state: number): number => state % 2;
    const stateAt = (vertex: number, axis: number): number => vertex * 2 + axis;
    const total = xs.length * height * 2;
    const cost = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const done = new Uint8Array(total);
    const estimate = (vertex: number): number => {
        const point = pointAt(vertex);
        return Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y);
    };

    const frontier: Frontier = { states: [], scores: [] };
    const first = stateAt(startVertex, isVertical(fromSide) ? 1 : 0);
    cost[first] = 0;
    pushState(frontier, first, estimate(startVertex));

    while (frontier.states.length > 0) {
        const state = popState(frontier);
        if (done[state] === 1) {
            continue;
        }
        done[state] = 1;
        const vertex = Math.floor(state / 2);
        if (vertex === goalVertex) {
            return [from, ...trace(cameFrom, state, pointAt), to];
        }
        const point = pointAt(vertex);
        const column = Math.floor(vertex / height);
        const row = vertex % height;
        for (const [dx, dy, axis] of [
            [-1, 0, 0],
            [1, 0, 0],
            [0, -1, 1],
            [0, 1, 1]
        ] as const) {
            const nextColumn = column + dx;
            const nextRow = row + dy;
            if (nextColumn < 0 || nextColumn >= xs.length || nextRow < 0 || nextRow >= height) {
                continue;
            }
            const nextVertex = nextColumn * height + nextRow;
            /* No turning back along a stub: the leg next to a node's border misses it, so without this
               a route leaves its port and runs straight back along that border. */
            if (
                (vertex === startVertex && dx === -fromNormal.x && dy === -fromNormal.y) ||
                (nextVertex === goalVertex && dx === toNormal.x && dy === toNormal.y)
            ) {
                continue;
            }
            const next = stateAt(nextVertex, axis);
            if (done[next] === 1) {
                continue;
            }
            const nextPoint = pointAt(nextVertex);
            if (near.some((box) => crosses(point, nextPoint, box))) {
                continue;
            }
            const walked = cost[state]! + Math.abs(nextPoint.x - point.x) + Math.abs(nextPoint.y - point.y) + (axis === axisOf(state) ? 0 : BEND_COST);
            if (walked >= cost[next]!) {
                continue;
            }
            cost[next] = walked;
            cameFrom[next] = state;
            pushState(frontier, next, walked + estimate(nextVertex));
        }
    }
    return null;
};

/* The coordinates a route may turn on: the two ends and the sides of every node, in order, since the
   search walks them as neighbors. */
const lanes = (seeds: readonly number[], blocked: readonly Bounds[], horizontal: boolean, low: number, high: number): number[] =>
    [...new Set([...seeds, ...blocked.flatMap((box) => (horizontal ? [box.minX, box.maxX] : [box.minY, box.maxY]))])]
        .filter((lane) => lane >= low && lane <= high)
        .sort((one, other) => one - other);

const trace = (cameFrom: Int32Array, state: number, pointAt: (vertex: number) => Point): Point[] => {
    const points: Point[] = [];
    for (let step = state; step !== -1; step = cameFrom[step]!) {
        points.push(pointAt(Math.floor(step / 2)));
    }
    return points.reverse();
};

/* The frontier of the search: a binary heap of states, the most promising one first. */
interface Frontier {
    states: number[];
    scores: number[];
}

const pushState = (frontier: Frontier, state: number, score: number): void => {
    frontier.states.push(state);
    frontier.scores.push(score);
    for (let child = frontier.states.length - 1; child > 0;) {
        const parent = Math.floor((child - 1) / 2);
        if (frontier.scores[parent]! <= frontier.scores[child]!) {
            return;
        }
        swapStates(frontier, parent, child);
        child = parent;
    }
};

const popState = (frontier: Frontier): number => {
    const top = frontier.states[0]!;
    const last = frontier.states.length - 1;
    swapStates(frontier, 0, last);
    frontier.states.pop();
    frontier.scores.pop();
    for (let parent = 0; ;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < frontier.states.length && frontier.scores[left]! < frontier.scores[smallest]!) {
            smallest = left;
        }
        if (right < frontier.states.length && frontier.scores[right]! < frontier.scores[smallest]!) {
            smallest = right;
        }
        if (smallest === parent) {
            return top;
        }
        swapStates(frontier, parent, smallest);
        parent = smallest;
    }
};

const swapStates = (frontier: Frontier, one: number, other: number): void => {
    [frontier.states[one], frontier.states[other]] = [frontier.states[other]!, frontier.states[one]!];
    [frontier.scores[one], frontier.scores[other]] = [frontier.scores[other]!, frontier.scores[one]!];
};

/* Whether every leg of a run stays clear of every node. */
const isClear = (points: readonly Point[], blocked: readonly Bounds[]): boolean =>
    points.every((point, index) => index === 0 || !blocked.some((box) => crosses(points[index - 1]!, point, box)));

/*
 * Whether the run from `a` to `b` passes through a node, by Liang-Barsky clipping: the run is kept
 * where it stays inside every edge's slab, and a slab that clips it away entirely means it misses.
 * A leg along the margin is a miss, which is what lets a route run right beside a node.
 */
const crosses = (a: Point, b: Point, box: Bounds): boolean => {
    if (box.maxX <= box.minX || box.maxY <= box.minY) {
        return false;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const slabs: readonly (readonly [number, number])[] = [
        [-dx, a.x - box.minX],
        [dx, box.maxX - a.x],
        [-dy, a.y - box.minY],
        [dy, box.maxY - a.y]
    ];
    let enter = 0;
    let leave = 1;
    for (const [edge, room] of slabs) {
        if (edge === 0) {
            if (room <= 0) {
                return false;
            }
            continue;
        }
        const t = room / edge;
        if (edge < 0) {
            enter = Math.max(enter, t);
        } else {
            leave = Math.min(leave, t);
        }
    }
    return enter < leave;
};

/* The run without the points that add nothing: a repeat, or a stop in the middle of a straight leg. */
const straighten = (points: readonly Point[]): Point[] => {
    const kept: Point[] = [];
    for (const point of points) {
        const last = kept[kept.length - 1];
        if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) <= 0.5) {
            continue;
        }
        const before = kept[kept.length - 2];
        if (last !== undefined && before !== undefined && (before.x - last.x) * (point.y - last.y) === (before.y - last.y) * (point.x - last.x)) {
            kept.pop();
        }
        kept.push(point);
    }
    return kept;
};

/* The run through the points with its corners rounded, each bend no wider than the legs it joins. */
const roundedPath = (points: readonly Point[], radius: number): string => {
    if (points.length < 2) {
        return '';
    }
    let path = `M ${points[0]!.x} ${points[0]!.y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const previous = points[i - 1]!;
        const current = points[i]!;
        const next = points[i + 1]!;
        const inLength = Math.hypot(current.x - previous.x, current.y - previous.y);
        const outLength = Math.hypot(next.x - current.x, next.y - current.y);
        const corner = Math.min(radius, inLength / 2, outLength / 2);
        const start = {
            x: current.x - ((current.x - previous.x) * corner) / inLength,
            y: current.y - ((current.y - previous.y) * corner) / inLength
        };
        const end = {
            x: current.x + ((next.x - current.x) * corner) / outLength,
            y: current.y + ((next.y - current.y) * corner) / outLength
        };
        path += ` L ${start.x} ${start.y} Q ${current.x} ${current.y} ${end.x} ${end.y}`;
    }
    const last = points[points.length - 1]!;
    return `${path} L ${last.x} ${last.y}`;
};

/* The middle of a route measured along its length, so a label rides the halfway point of the whole run. */
const halfway = (points: readonly Point[]): Point => {
    const legs = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
    let left = legs.reduce((total, length) => total + length, 0) / 2;
    for (const [index, length] of legs.entries()) {
        if (left <= length || index === legs.length - 1) {
            const ratio = length === 0 ? 0 : left / length;
            const from = points[index]!;
            const to = points[index + 1]!;
            return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
        }
        left -= length;
    }
    return points[0]!;
};
