import type { UsageProvider } from '@ruimte/contracts';
import type { BenchmarkModel, BenchmarkPoint } from '@ruimte/pulsar';
import { niceScale } from '@ruimte/agents-react/usage/summary';

export type CostScale = 'log' | 'linear';

/* A model the chart can draw: a provider it has a color and a logo for. */
export interface ChartModel extends BenchmarkModel {
    provider: UsageProvider;
}

type Measured = Pick<BenchmarkPoint, 'costPerTask' | 'intelligence'>;

const PROVIDERS: readonly string[] = ['claude', 'codex'] satisfies UsageProvider[];

/* The address book may know a provider this client does not; it has no color here, so it is left out. */
export const chartModels = (models: readonly BenchmarkModel[]): ChartModel[] =>
    models.filter((model): model is ChartModel => PROVIDERS.includes(model.provider));

/*
 * The points no other point beats on both axes: none is at least as cheap and at least as good, and
 * better on one of the two. In order of cost, which is the order the band runs through them.
 */
export const frontier = <T extends Measured>(points: readonly T[]): T[] => {
    const sorted = [...points].sort((one, other) => one.costPerTask - other.costPerTask || other.intelligence - one.intelligence);
    const kept: T[] = [];
    let best = -Infinity;
    for (const point of sorted) {
        if (point.intelligence > best) {
            kept.push(point);
            best = point.intelligence;
        }
    }
    return kept;
};

/* Current models take the first shapes, so the ones shown by default are the easiest to tell apart. */
export const MARK_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'triangle-down', 'hexagon', 'cross'] as const;

export type MarkShape = (typeof MARK_SHAPES)[number];

export interface ModelMark {
    color: string;
    shape: MarkShape;
}

/*
 * Every model in the color of its provider and with a shape of its own within that provider, current
 * models first. Past eight models of one provider a shape comes round again; the label at the end of
 * its line still tells them apart.
 */
export const modelMarks = (models: readonly ChartModel[]): Map<string, ModelMark> => {
    const marks = new Map<string, ModelMark>();
    const used: Partial<Record<UsageProvider, number>> = {};
    for (const model of [...models.filter((entry) => !entry.legacy), ...models.filter((entry) => entry.legacy)]) {
        const index = used[model.provider] ?? 0;
        used[model.provider] = index + 1;
        marks.set(model.id, { color: `var(--chart-${model.provider})`, shape: MARK_SHAPES[index % MARK_SHAPES.length]! });
    }
    return marks;
};

const round = (value: number): number => Math.round(value * 100) / 100;

/* The corners of a shape around (x, y), the first one straight up; `radii` alternate for a star. */
const polygon = (x: number, y: number, corners: number, radii: readonly number[], turn = 0): string =>
    Array.from({ length: corners }, (_, index) => {
        const angle = turn + (index / corners) * 2 * Math.PI;
        const radius = radii[index % radii.length]!;
        return `${index === 0 ? 'M' : 'L'}${round(x + radius * Math.sin(angle))} ${round(y - radius * Math.cos(angle))}`;
    }).join(' ') + ' Z';

/*
 * The SVG path of a mark centered on (x, y). `size` is the radius of the circle; the other shapes are
 * scaled to about the same area, so no model looks heavier than another.
 */
export const markPath = (shape: MarkShape, x: number, y: number, size: number): string => {
    switch (shape) {
        case 'circle':
            return `M${round(x - size)} ${y} a${size} ${size} 0 1 0 ${size * 2} 0 a${size} ${size} 0 1 0 ${-size * 2} 0 Z`;
        case 'square':
            return polygon(x, y, 4, [size * 1.25], Math.PI / 4);
        case 'diamond':
            return polygon(x, y, 4, [size * 1.35]);
        case 'triangle':
            return polygon(x, y, 3, [size * 1.5]);
        case 'triangle-down':
            return polygon(x, y, 3, [size * 1.5], Math.PI);
        case 'hexagon':
            return polygon(x, y, 6, [size * 1.1]);
        case 'star':
            return polygon(x, y, 10, [size * 1.6, size * 0.7]);
        case 'cross': {
            const arm = size * 1.3;
            const half = size * 0.45;
            const corners = [
                [-half, -arm],
                [half, -arm],
                [half, -half],
                [arm, -half],
                [arm, half],
                [half, half],
                [half, arm],
                [-half, arm],
                [-half, half],
                [-arm, half],
                [-arm, -half],
                [-half, -half]
            ];
            return corners.map(([dx, dy], index) => `${index === 0 ? 'M' : 'L'}${round(x + dx!)} ${round(y + dy!)}`).join(' ') + ' Z';
        }
    }
};

export interface Axis {
    ticks: number[];
    /* Where a value falls, from 0 at the start of the axis to 1 at its end. */
    at(value: number): number;
}

/* Decades on a log axis, since the cheapest effort and the dearest lie three of them apart. */
export const costAxis = (costs: readonly number[], scale: CostScale): Axis => {
    if (scale === 'linear') {
        const { max, step } = niceScale(Math.max(0, ...costs));
        return { ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step), at: (value) => value / max };
    }
    const positive = costs.filter((cost) => cost > 0);
    const low = positive.length === 0 ? -1 : Math.floor(Math.log10(Math.min(...positive)));
    const ceiling = positive.length === 0 ? 1 : Math.ceil(Math.log10(Math.max(...positive)));
    const high = ceiling > low ? ceiling : low + 1;
    return {
        ticks: Array.from({ length: high - low + 1 }, (_, index) => 10 ** (low + index)),
        at: (value) => (Math.log10(value) - low) / (high - low)
    };
};

export const intelligenceAxis = (values: readonly number[]): Axis => {
    const step = 10;
    const low = values.length === 0 ? 0 : Math.floor(Math.min(...values) / step) * step;
    const ceiling = values.length === 0 ? 60 : Math.ceil(Math.max(...values) / step) * step;
    const high = ceiling > low ? ceiling : low + step;
    return {
        ticks: Array.from({ length: (high - low) / step + 1 }, (_, index) => low + index * step),
        at: (value) => (value - low) / (high - low)
    };
};

export interface Spot {
    x: number;
    y: number;
}

export type LabelAnchor = 'start' | 'middle' | 'end';

/* Where a label sits: `x` and `y` are where its text starts, centers or ends, and the middle of its line. */
export interface LabelPlace extends Spot {
    anchor: LabelAnchor;
    box: Box;
}

export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export const LABEL_HEIGHT = 14;

/* Around a point, in the order they are tried: beside and above first, since the lines climb to the right. */
const LABEL_OFFSETS: readonly [dx: number, dy: number, anchor: LabelAnchor][] = [
    [10, -10, 'start'],
    [0, -16, 'middle'],
    [-10, -10, 'end'],
    [10, 10, 'start'],
    [0, 16, 'middle'],
    [-10, 10, 'end'],
    [10, 0, 'start'],
    [-10, 0, 'end']
];

/* Every so many pixels along a line, a sample a label is scored against. */
const SAMPLE_STEP = 4;

export const boxOf = (x: number, y: number, anchor: LabelAnchor, width: number): Box => {
    const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    return { left, top: y - LABEL_HEIGHT / 2, right: left + width, bottom: y + LABEL_HEIGHT / 2 };
};

export const overlaps = (one: Box, other: Box): boolean => one.left < other.right && other.left < one.right && one.top < other.bottom && other.top < one.bottom;

const overlapArea = (one: Box, other: Box): number =>
    Math.max(0, Math.min(one.right, other.right) - Math.max(one.left, other.left)) *
    Math.max(0, Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top));

/*
 * A spot for the name of every line: around one of its points, the last one preferred, where it crosses
 * the fewest lines and points and no label placed before it. The lines that end furthest right choose
 * first, since that is where they crowd. `widths` is the width of every name; a line without points gets `null`.
 */
export const placeLabels = (lines: readonly (readonly Spot[])[], widths: readonly number[], bounds: Box): (LabelPlace | null)[] => {
    const samples: { x: number; y: number; line: number; dot: boolean }[] = [];
    lines.forEach((points, line) => {
        points.forEach((point, index) => {
            samples.push({ ...point, line, dot: true });
            const next = points[index + 1];
            if (next === undefined) {
                return;
            }
            const steps = Math.max(2, Math.ceil(Math.hypot(next.x - point.x, next.y - point.y) / SAMPLE_STEP));
            for (let step = 1; step < steps; step++) {
                samples.push({ x: point.x + ((next.x - point.x) * step) / steps, y: point.y + ((next.y - point.y) * step) / steps, line, dot: false });
            }
        });
    });
    const crossings = (box: Box, line: number): number => {
        let score = 0;
        for (const sample of samples) {
            if (sample.x > box.left - 3 && sample.x < box.right + 3 && sample.y > box.top - 3 && sample.y < box.bottom + 3) {
                score += sample.line === line ? (sample.dot ? 3 : 1.5) : sample.dot ? 6 : 4;
            }
        }
        return score;
    };

    const placed: Box[] = [];
    const result: (LabelPlace | null)[] = lines.map(() => null);
    const order = lines
        .map((points, line) => ({ line, end: points.at(-1)?.x }))
        .filter((entry): entry is { line: number; end: number } => entry.end !== undefined)
        .sort((one, other) => other.end - one.end);
    for (const { line } of order) {
        const points = lines[line]!;
        let best: { score: number; place: LabelPlace } | null = null;
        for (const [index, point] of points.entries()) {
            for (const [tried, [dx, dy, anchor]] of LABEL_OFFSETS.entries()) {
                const x = point.x + dx;
                const y = point.y + dy;
                const box = boxOf(x, y, anchor, widths[line] ?? 0);
                let score = crossings(box, line) * 10 + (points.length - 1 - index) * 14 + tried * 2;
                for (const other of placed) {
                    score += overlapArea(box, other) * 2;
                }
                if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) {
                    score += 5000;
                }
                if (best === null || score < best.score) {
                    best = { score, place: { x, y, anchor, box } };
                }
            }
        }
        if (best !== null) {
            placed.push(best.place.box);
            result[line] = best.place;
        }
    }
    return result;
};

/* The point closest to (x, y) within `reach` pixels, so the pointer need not land on a mark exactly. */
export const nearestPoint = (lines: readonly (readonly Spot[])[], x: number, y: number, reach: number): PointAt | null => {
    let nearest: PointAt | null = null;
    let distance = reach;
    lines.forEach((points, line) => {
        points.forEach((point, index) => {
            const away = Math.hypot(point.x - x, point.y - y);
            if (away <= distance) {
                distance = away;
                nearest = { line, index };
            }
        });
    });
    return nearest;
};

export interface PointAt {
    line: number;
    index: number;
}

/*
 * Where an arrow key goes from a point: left and right along the efforts of its line, up and down to
 * the line before or after it that has points, at the same effort or the last one it has.
 * `counts` is the number of points of every line in the order they are listed.
 */
export const movePoint = (counts: readonly number[], from: PointAt, key: string): PointAt | null => {
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const index = from.index + (key === 'ArrowRight' ? 1 : -1);
        return index >= 0 && index < (counts[from.line] ?? 0) ? { line: from.line, index } : null;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        const direction = key === 'ArrowDown' ? 1 : -1;
        for (let line = from.line + direction; line >= 0 && line < counts.length; line += direction) {
            const count = counts[line] ?? 0;
            if (count > 0) {
                return { line, index: Math.min(from.index, count - 1) };
            }
        }
    }
    return null;
};
