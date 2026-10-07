import type { UsageProvider } from '@ruimte/contracts';
import type { BenchmarkMeasurement, BenchmarkModel } from '@ruimte/pulsar';
import { niceScale } from '@adecore/agents-react/usage/summary';

export type CostScale = 'log' | 'linear';

export type ChartPoint = Omit<BenchmarkMeasurement, 'modelId'>;

export interface ChartModel extends Omit<BenchmarkModel, 'points'> {
    provider: UsageProvider;
    points: ChartPoint[];
}

type Measured = { costPerTask: number; intelligence: number };

const PROVIDERS: readonly string[] = ['claude', 'codex'] satisfies UsageProvider[];
const EFFORTS = ['off', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'];

export function compareEfforts(one: string, other: string): number {
    const order = (effort: string): number => (EFFORTS.includes(effort) ? EFFORTS.indexOf(effort) : EFFORTS.length);
    return order(one) - order(other) || one.localeCompare(other);
}

/* The address book may know a provider this client does not; it has no color here, so it is left out. */
export function chartModels(models: readonly BenchmarkModel[], measurements?: readonly BenchmarkMeasurement[]): ChartModel[] {
    return models
        .filter((model) => PROVIDERS.includes(model.provider))
        .map((model) => ({
            ...model,
            provider: model.provider as UsageProvider,
            points: (measurements === undefined
                ? [...model.points]
                : measurements.filter((point) => point.modelId === model.id).map(({ modelId: _modelId, ...point }) => point)
            ).sort((one, other) => compareEfforts(one.effort, other.effort))
        }));
}

/*
 * The points no other point beats on both axes: none is at least as cheap and at least as good, and
 * better on one of the two. In order of cost, which is the order the band runs through them.
 */
export function frontier<T extends Measured>(points: readonly T[]): T[] {
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
}

export interface ModelMark {
    color: string;
}

/* Legacy entries must not shift the colors of current models. */
export function modelMarks(models: readonly ChartModel[]): Map<string, ModelMark> {
    const marks = new Map<string, ModelMark>();
    const used: Partial<Record<UsageProvider, number>> = {};
    for (const model of [...models.filter((entry) => !entry.legacy), ...models.filter((entry) => entry.legacy)]) {
        const index = used[model.provider] ?? 0;
        used[model.provider] = index + 1;
        marks.set(model.id, { color: `var(--model-chart-${model.provider}-${index % 6})` });
    }
    return marks;
}

export interface Axis {
    ticks: number[];
    /* Where a value falls, from 0 at the start of the axis to 1 at its end. */
    at(value: number): number;
}

/* Decades on a log axis, since the cheapest effort and the dearest lie three of them apart. */
export function costAxis(costs: readonly number[], scale: CostScale): Axis {
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
}

export function intelligenceAxis(values: readonly number[]): Axis {
    const step = 10;
    const low = values.length === 0 ? 0 : Math.floor(Math.min(...values) / step) * step;
    const ceiling = values.length === 0 ? 60 : Math.ceil(Math.max(...values) / step) * step;
    const high = ceiling > low ? ceiling : low + step;
    return {
        ticks: Array.from({ length: (high - low) / step + 1 }, (_, index) => low + index * step),
        at: (value) => (value - low) / (high - low)
    };
}

export interface Spot {
    x: number;
    y: number;
}

/* The point closest to (x, y) within `reach` pixels, so the pointer need not land on a mark exactly. */
export function nearestPoint(lines: readonly (readonly Spot[])[], x: number, y: number, reach: number): PointAt | null {
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
}

export interface PointAt {
    line: number;
    index: number;
}

/* Skip empty model rows when moving vertically. */
export function movePoint(counts: readonly number[], from: PointAt, key: string): PointAt | null {
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
}
