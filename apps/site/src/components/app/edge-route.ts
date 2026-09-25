// A connector's route as `apps/client/src/canvas/edge-route.ts` draws it without obstacles: out of the
// middle of the facing sides, a straight stub, one rail between them, and every corner rounded.

export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

type Point = readonly [number, number];

export interface Route {
    readonly d: string;
    readonly start: Point;
    readonly end: Point;
    /** Unit normals pointing out of the node each end sits on, which is how a marker is turned. */
    readonly startAlong: Point;
    readonly endAlong: Point;
}

const NODE_GAP = 9;
const CORNER = 15;

function sidePoint(rect: Rect, along: Point): Point {
    const [ax, ay] = along;
    const x = ax === 0 ? rect.x + rect.w / 2 : ax > 0 ? rect.x + rect.w + NODE_GAP : rect.x - NODE_GAP;
    const y = ay === 0 ? rect.y + rect.h / 2 : ay > 0 ? rect.y + rect.h + NODE_GAP : rect.y - NODE_GAP;
    return [x, y];
}

function rounded(points: readonly Point[]): string {
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
        const [px, py] = points[i - 1];
        const [cx, cy] = points[i];
        const [nx, ny] = points[i + 1];
        const inLeg = Math.hypot(cx - px, cy - py);
        const outLeg = Math.hypot(nx - cx, ny - cy);
        const r = Math.min(CORNER, inLeg / 2, outLeg / 2);
        const before: Point = [cx - ((cx - px) / inLeg) * r, cy - ((cy - py) / inLeg) * r];
        const after: Point = [cx + ((nx - cx) / outLeg) * r, cy + ((ny - cy) / outLeg) * r];
        d += ` L ${before[0]} ${before[1]} Q ${cx} ${cy} ${after[0]} ${after[1]}`;
    }
    const last = points[points.length - 1];
    return `${d} L ${last[0]} ${last[1]}`;
}

export function routeBetween(from: Rect, to: Rect): Route {
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const startAlong: Point = horizontal ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
    const endAlong: Point = [-startAlong[0], -startAlong[1]];
    const start = sidePoint(from, startAlong);
    const end = sidePoint(to, endAlong);
    const axis = horizontal ? 0 : 1;
    const cross = horizontal ? 1 : 0;

    if (Math.abs(start[cross] - end[cross]) < 1) {
        return { d: `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`, start, end, startAlong, endAlong };
    }

    // Midway between the ends, which keeps both stubs whenever there is room for them.
    const rail = (start[axis] + end[axis]) / 2;
    const bend = (at: number, other: number): Point => (horizontal ? [at, other] : [other, at]);
    const points: Point[] = [start, bend(rail, start[cross]), bend(rail, end[cross]), end];
    return { d: rounded(points), start, end, startAlong, endAlong };
}

/** A marker's path at an end, in `marker-path.ts`'s terms: `b` along the normal, `s` across it. */
export function markerPath(kind: 'dot' | 'chevron' | 'arrow', at: Point, along: Point): string {
    const perp: Point = [-along[1], along[0]];
    const c = (b: number, s: number): string => `${at[0] + along[0] * b + perp[0] * s} ${at[1] + along[1] * b + perp[1] * s}`;
    switch (kind) {
        case 'dot':
            return `M ${c(-5, 0)} A 5 5 0 1 0 ${c(5, 0)} A 5 5 0 1 0 ${c(-5, 0)} Z`;
        case 'chevron':
            return `M ${c(6, 6)} L ${c(0, 0)} L ${c(6, -6)}`;
        case 'arrow':
            return `M ${c(0, 0)} L ${c(10, 5)} L ${c(10, -5)} Z`;
    }
}
