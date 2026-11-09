import { niceScale } from '@adecore/agents-react/usage';
import type { BenchmarkLab, BenchmarkMeasurement, BenchmarkModel } from '@ruimte/pulsar';

export type CostScale = 'log' | 'linear';

export type ChartPoint = Omit<BenchmarkMeasurement, 'modelId'>;

export interface ChartModel extends Omit<BenchmarkModel, 'points'> {
    lab: BenchmarkLab;
    points: ChartPoint[];
}

const EFFORTS = ['off', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'];

export function compareEfforts(one: string, other: string): number {
    const order = (effort: string): number => (EFFORTS.includes(effort) ? EFFORTS.indexOf(effort) : EFFORTS.length);
    return order(one) - order(other) || one.localeCompare(other);
}

/* A model whose lab the address book did not describe has no mark or color, so it is left out. */
export function chartModels(models: readonly BenchmarkModel[], labs: readonly BenchmarkLab[], measurements?: readonly BenchmarkMeasurement[]): ChartModel[] {
    return models.flatMap((model) => {
        const lab = labs.find((entry) => entry.id === model.provider);
        if (lab === undefined) {
            return [];
        }
        const points = (
            measurements === undefined
                ? [...model.points]
                : measurements.filter((point) => point.modelId === model.id).map(({ modelId: _modelId, ...point }) => point)
        ).sort((one, other) => compareEfforts(one.effort, other.effort));
        return [{ ...model, lab, points }];
    });
}

export interface ModelMark {
    color: string;
}

/*
 * Legacy entries must not shift the colors of current models. `light-dark()` follows the theme's
 * `color-scheme`, so a color drawn as an SVG fill must go through `style`, not the attribute.
 */
export function modelMarks(models: readonly ChartModel[]): Map<string, ModelMark> {
    const marks = new Map<string, ModelMark>();
    const used = new Map<string, number>();
    for (const model of [...models.filter((entry) => !entry.legacy), ...models.filter((entry) => entry.legacy)]) {
        const index = used.get(model.lab.id) ?? 0;
        used.set(model.lab.id, index + 1);
        const { light, dark } = model.lab.colors;
        marks.set(model.id, {
            color: `light-dark(${light[index % light.length]}, ${dark[index % dark.length]})`
        });
    }
    return marks;
}

export function chartLabs(labs: readonly BenchmarkLab[], models: readonly ChartModel[]): BenchmarkLab[] {
    return labs.filter((lab) => models.some((model) => model.lab.id === lab.id));
}

export interface Axis {
    ticks: number[];
}

/* From zero to a round number above the dearest, the same ends whichever efforts are filtered out. */
export function costAxis(costs: readonly number[]): Axis {
    const { max, step } = niceScale(Math.max(0, ...costs));
    return { ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
}

export function intelligenceAxis(values: readonly number[]): Axis {
    const step = 10;
    const low = values.length === 0 ? 0 : Math.floor(Math.min(...values) / step) * step;
    const ceiling = values.length === 0 ? 60 : Math.ceil(Math.max(...values) / step) * step;
    const high = ceiling > low ? ceiling : low + step;
    return { ticks: Array.from({ length: (high - low) / step + 1 }, (_, index) => low + index * step) };
}
