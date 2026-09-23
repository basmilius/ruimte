import type { UsageProvider } from '@ruimte/contracts';
import type { BenchmarkModel, BenchmarkPoint } from '@ruimte/pulsar';
import { niceScale } from '@/shell/usage/summary';

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

/* The lightness steps of a provider's color in `styles.css`. */
const COLOR_STEPS = 5;

/*
 * A step of its provider's color per model, current models first, so the models shown by default never
 * share one. A legacy model may share a step with a current one; the label at the end of its line tells them apart.
 */
export const modelColors = (models: readonly ChartModel[]): Map<string, string> => {
    const colors = new Map<string, string>();
    const used: Partial<Record<UsageProvider, number>> = {};
    for (const model of [...models.filter((entry) => !entry.legacy), ...models.filter((entry) => entry.legacy)]) {
        const index = used[model.provider] ?? 0;
        used[model.provider] = index + 1;
        colors.set(model.id, `var(--chart-${model.provider}-${(index % COLOR_STEPS) + 1})`);
    }
    return colors;
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

/*
 * The y of each label at the end of a line, moved apart until none is closer than `gap` to the next,
 * and kept between `top` and `bottom`. The labels keep their order, so each still sits by its own line.
 */
export const spreadLabels = (wanted: readonly number[], gap: number, top: number, bottom: number): number[] => {
    const order = wanted.map((y, index) => ({ y, index })).sort((one, other) => one.y - other.y);
    const placed = order.map((entry) => entry.y);
    for (let i = 0; i < placed.length; i++) {
        placed[i] = Math.max(placed[i]!, i === 0 ? top : placed[i - 1]! + gap);
    }
    for (let i = placed.length - 1; i >= 0; i--) {
        placed[i] = Math.min(placed[i]!, i === placed.length - 1 ? bottom : placed[i + 1]! - gap);
    }
    const result = new Array<number>(wanted.length);
    order.forEach((entry, rank) => {
        result[entry.index] = placed[rank]!;
    });
    return result;
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
