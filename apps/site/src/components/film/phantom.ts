// The look of the computer-use cursor, ported from `apps/computer-use/Sources/Phantom` (`PhantomForms.swift`,
// `OverlayStyle.swift`, `Motion.swift`), so the page draws what the helper draws. Each form lives in a 24 × 24 box
// with the hotspot at (4, 3.5), y down.

type Point = readonly [number, number];

// One step of an outline: a straight line or a cubic to the last point.
type Segment = readonly [Point] | readonly [Point, Point, Point];

interface Outline {
    readonly start: Point;
    readonly segments: readonly Segment[];
}

const SAMPLES = 160;

function poly(corners: readonly Point[]): Outline {
    return { start: corners[0]!, segments: [...corners.slice(1), corners[0]!].map((corner) => [corner] as const) };
}

/* A fine polyline of the outline that ends where it starts. */
function flatten(outline: Outline): Point[] {
    const steps = 64;
    const polyline: Point[] = [outline.start];
    let current = outline.start;
    for (const segment of outline.segments) {
        if (segment.length === 1) {
            polyline.push(segment[0]);
        } else {
            const [first, second, end] = segment;
            for (let step = 1; step <= steps; step += 1) {
                const t = step / steps;
                const inverse = 1 - t;
                const a = inverse ** 3;
                const b = 3 * inverse * inverse * t;
                const c = 3 * inverse * t * t;
                const d = t ** 3;
                polyline.push([a * current[0] + b * first[0] + c * second[0] + d * end[0], a * current[1] + b * first[1] + c * second[1] + d * end[1]]);
            }
        }
        current = segment[segment.length - 1]!;
    }
    return polyline;
}

/*
 * The outline as 160 points spread evenly along its length, clockwise on the screen and starting at the point with
 * the smallest x + y, so any two forms morph point by point without turning inside out.
 */
function sample(outline: Outline): string {
    const polyline = flatten(outline);
    const lengths = [0];
    for (let i = 1; i < polyline.length; i += 1) {
        lengths.push(lengths[i - 1]! + Math.hypot(polyline[i]![0] - polyline[i - 1]![0], polyline[i]![1] - polyline[i - 1]![1]));
    }
    const total = lengths[lengths.length - 1]!;
    let points: Point[] = [];
    let segment = 1;
    for (let i = 0; i < SAMPLES; i += 1) {
        const along = (total * i) / SAMPLES;
        while (segment < lengths.length - 1 && lengths[segment]! < along) {
            segment += 1;
        }
        const span = lengths[segment]! - lengths[segment - 1]!;
        const t = span > 0 ? (along - lengths[segment - 1]!) / span : 0;
        const from = polyline[segment - 1]!;
        const to = polyline[segment]!;
        points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
    let area = 0;
    points.forEach((point, i) => {
        const next = points[(i + 1) % points.length]!;
        area += point[0] * next[1] - next[0] * point[1];
    });
    if (area < 0) {
        points.reverse();
    }
    const start = points.reduce((best, point, i) => (point[0] + point[1] < points[best]![0] + points[best]![1] ? i : best), 0);
    points = [...points.slice(start), ...points.slice(0, start)];
    return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`;
}

export const PHANTOM_ARROW = sample(
    poly([
        [4, 3.5],
        [20.5, 10.5],
        [13.5, 13.5],
        [10.5, 20.5]
    ])
);

/** The text cursor of typing, 16 tall and centered on the hotspot. */
export const PHANTOM_BEAM = sample(
    poly([
        [0.9, -4.6],
        [7.1, -4.6],
        [7.1, -3.5],
        [4.65, -3.5],
        [4.65, 10.5],
        [7.1, 10.5],
        [7.1, 11.6],
        [0.9, 11.6],
        [0.9, 10.5],
        [3.35, 10.5],
        [3.35, -3.5],
        [0.9, -3.5]
    ])
);

/** The arrow as the menu bar item draws it, without sampling. */
export const PHANTOM_ARROW_PLAIN = 'M4 3.5 L20.5 10.5 L13.5 13.5 L10.5 20.5 Z';

/** Graphite with a white rim on every ground; color sits only in the signs. */
export const PHANTOM_COLORS = {
    ink: '#1d1d1f',
    rim: '#ffffff',
    needs: '#f59e0b',
    error: '#e5484d',
    done: '#30a46c',
    paused: '#8e8e93'
} as const;

/** The system's smooth curve, on which the forms morph and the signs come and go. */
export const SMOOTH = [0.32, 0.72, 0, 1] as const;

/** How long the cursor takes to travel `distance` points, in seconds: about 0.45 s across a button, 1 s across the screen. */
export function travelTime(distance: number): number {
    return Math.min(1000, Math.max(420, 360 + 150 * Math.log2(1 + distance / 30))) / 1000;
}

/** The point on the arc from `from` to `to` at `t`: the control point sits off the middle by 18 percent of the distance, always up the screen. */
export function travelPoint(from: Point, to: Point, t: number): Point {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
        return from;
    }
    let perpendicular: Point = [-dy / distance, dx / distance];
    if (perpendicular[1] > 0) {
        perpendicular = [-perpendicular[0], -perpendicular[1]];
    }
    const control: Point = [from[0] + dx / 2 + perpendicular[0] * distance * 0.18, from[1] + dy / 2 + perpendicular[1] * distance * 0.18];
    const inverse = 1 - t;
    return [
        inverse * inverse * from[0] + 2 * inverse * t * control[0] + t * t * to[0],
        inverse * inverse * from[1] + 2 * inverse * t * control[1] + t * t * to[1]
    ];
}
