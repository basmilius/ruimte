import { formatDecimal, formatTokens, formatUsdSignificant } from '@adecore/ui/format';
import { compareEfforts, costAxis, intelligenceAxis, type Axis, type ChartModel, type ChartPoint } from './chart';

export const MODEL_VIEWS = ['comparison', 'speed', 'score', 'coding', 'agentic', 'cost', 'totalCost'] as const;
export type ModelView = (typeof MODEL_VIEWS)[number];
export type BarMetric = Exclude<ModelView, 'comparison' | 'speed'>;
export type Metric = Exclude<keyof ChartPoint, 'effort'>;
export const VIEW_METRICS: Record<ModelView, Metric> = {
    comparison: 'costPerTask',
    speed: 'outputSpeed',
    score: 'intelligence',
    coding: 'coding',
    agentic: 'agentic',
    cost: 'costPerTask',
    totalCost: 'totalCost'
};
export const METRICS: readonly Metric[] = ['intelligence', 'coding', 'agentic', 'costPerTask', 'totalCost', 'outputSpeed'];

export function metricValue(point: ChartPoint, metric: Metric): number | null {
    const value = point[metric];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatMetric(value: number, metric: Metric, compact = false): string {
    if (metric === 'costPerTask' || metric === 'totalCost') {
        return compact && value >= 1000 ? `$${formatTokens(value)}` : formatUsdSignificant(value);
    }
    return formatDecimal(value);
}

export function shortModelName(name: string): string {
    return name.replace(/^Claude /, '');
}

export function lowerIsBetter(metric: Metric): boolean {
    return metric === 'costPerTask' || metric === 'totalCost';
}

export interface ModelPoint extends ChartPoint {
    key: string;
    modelId: string;
    modelName: string;
}

export interface PointInteraction {
    reference: string | null;
    candidate: string | null;
    onActivate(key: string): void;
    onPreview(key: string | null): void;
    onClear(): void;
}

const GRADED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function pointKey(modelId: string, effort: string): string {
    return JSON.stringify([modelId, effort]);
}

export function modelPoints(models: readonly ChartModel[]): ModelPoint[] {
    return models.flatMap((model) =>
        model.points.map((point) => ({ ...point, key: pointKey(model.id, point.effort), modelId: model.id, modelName: model.name }))
    );
}

export function measuredEfforts(models: readonly ChartModel[]): string[] {
    return [...new Set(models.flatMap((model) => model.points.map((point) => point.effort)))].sort(compareEfforts);
}

export function sortedPoints(points: readonly ModelPoint[], view: BarMetric): ModelPoint[] {
    const metric = VIEW_METRICS[view];
    const direction = lowerIsBetter(metric) ? 1 : -1;
    return points
        .filter((point) => metricValue(point, metric) !== null)
        .sort((one, other) => direction * (metricValue(one, metric)! - metricValue(other, metric)!) || one.key.localeCompare(other.key));
}

export function barGroups(models: readonly ChartModel[], view: BarMetric, grouped: boolean): ModelPoint[][] {
    if (!grouped) {
        return [sortedPoints(modelPoints(models), view)];
    }
    const metric = VIEW_METRICS[view];
    const direction = lowerIsBetter(metric) ? 1 : -1;
    return models
        .map((model) => modelPoints([model]).filter((point) => metricValue(point, metric) !== null))
        .filter((group) => group.length > 0)
        .sort(
            (one, other) =>
                direction * (Math.max(...one.map((point) => metricValue(point, metric)!)) - Math.max(...other.map((point) => metricValue(point, metric)!))) ||
                one[0]!.modelId.localeCompare(other[0]!.modelId)
        );
}

export function barAxis(models: readonly ChartModel[], view: BarMetric): Axis {
    const metric = VIEW_METRICS[view];
    const values = modelPoints(models).flatMap((point) => metricValue(point, metric) ?? []);
    return lowerIsBetter(metric) ? costAxis(values, 'linear') : intelligenceAxis([0, ...values]);
}

export function metricChange(reference: ChartPoint, candidate: ChartPoint, metric: Metric): { value: number; ratio: boolean } | null {
    const from = metricValue(reference, metric);
    const to = metricValue(candidate, metric);
    if (from === null || to === null) {
        return null;
    }
    const ratio = metric === 'costPerTask' || metric === 'totalCost' || metric === 'outputSpeed';
    if (ratio && from <= 0) {
        return null;
    }
    const value = ratio ? to / from : to - from;
    return Number.isFinite(value) ? { value, ratio } : null;
}

/* An absent or filtered effort is a gap, not an interpolated measurement. */
export function effortSegments<T extends ChartPoint>(points: readonly T[], original: readonly ChartPoint[]): T[][] {
    const segments: T[][] = [];
    for (const point of points) {
        const previous = segments.at(-1)?.at(-1);
        const consecutive =
            previous !== undefined &&
            original.findIndex((entry) => entry.effort === point.effort) === original.findIndex((entry) => entry.effort === previous.effort) + 1;
        const from = previous === undefined ? -1 : GRADED_EFFORTS.indexOf(previous.effort);
        const to = GRADED_EFFORTS.indexOf(point.effort);
        if (consecutive && (from < 0 || to < 0 || to === from + 1)) {
            segments.at(-1)!.push(point);
        } else {
            segments.push([point]);
        }
    }
    return segments;
}

export function pointDifference(reference: ChartPoint, candidate: ChartPoint): { score: number | null; costRatio: number | null } {
    return {
        score: metricChange(reference, candidate, 'intelligence')?.value ?? null,
        costRatio: metricChange(reference, candidate, 'costPerTask')?.value ?? null
    };
}

export interface ComparisonSelection {
    hiddenModels: ReadonlySet<string>;
    hiddenEfforts: ReadonlySet<string>;
    legacy: boolean;
    reference: string | null;
    candidate: string | null;
    notice: 'referenceHidden' | 'candidateHidden' | 'cleared' | null;
}

export type ComparisonAction =
    | { type: 'model' | 'effort'; id: string }
    | { type: 'legacy'; value: boolean }
    | { type: 'activate'; key: string }
    | { type: 'candidate'; key: string }
    | { type: 'models' | 'efforts' | 'clear' | 'reset' }
    | { type: 'provider'; provider: string; show: boolean };

export function initialSelection(): ComparisonSelection {
    return { hiddenModels: new Set(), hiddenEfforts: new Set(), legacy: false, reference: null, candidate: null, notice: null };
}

export function comparisonModels(
    models: readonly ChartModel[],
    state: ComparisonSelection
): { listed: ChartModel[]; selected: ChartModel[]; drawn: ChartModel[] } {
    const listed = models.filter((model) => state.legacy || !model.legacy);
    const selected = listed.filter((model) => !state.hiddenModels.has(model.id));
    const drawn = selected
        .map((model) => ({ ...model, points: model.points.filter((point) => !state.hiddenEfforts.has(point.effort)) }))
        .filter((model) => model.points.length > 0);
    return { listed, selected, drawn };
}

export function reduceComparison(models: readonly ChartModel[], state: ComparisonSelection, action: ComparisonAction): ComparisonSelection {
    let next: ComparisonSelection = { ...state, notice: null };
    switch (action.type) {
        case 'reset':
            return initialSelection();
        case 'provider': {
            const hidden = new Set(state.hiddenModels);
            for (const model of models.filter((model) => model.provider === action.provider)) {
                if (action.show) {
                    hidden.delete(model.id);
                } else {
                    hidden.add(model.id);
                }
            }
            next.hiddenModels = hidden;
            break;
        }
        case 'model':
        case 'effort': {
            const field = action.type === 'model' ? 'hiddenModels' : 'hiddenEfforts';
            const hidden = new Set(state[field]);
            if (!hidden.delete(action.id)) {
                hidden.add(action.id);
            }
            next[field] = hidden;
            break;
        }
        case 'legacy':
            next.legacy = action.value;
            break;
        case 'models':
            next.hiddenModels = new Set();
            break;
        case 'efforts':
            next.hiddenEfforts = new Set();
            break;
        case 'clear':
            return { ...next, reference: null, candidate: null, notice: 'cleared' };
        case 'activate':
            if (state.reference === action.key) {
                return { ...next, reference: null, candidate: null, notice: 'cleared' };
            }
            next = state.reference === null ? { ...next, reference: action.key, candidate: null } : { ...next, candidate: action.key };
            break;
        case 'candidate':
            next.candidate = action.key === state.reference ? null : action.key;
            break;
    }
    const keys = new Set(modelPoints(comparisonModels(models, next).drawn).map((point) => point.key));
    if (next.reference !== null && !keys.has(next.reference)) {
        return { ...next, reference: null, candidate: null, notice: 'referenceHidden' };
    }
    if (next.candidate !== null && !keys.has(next.candidate)) {
        return { ...next, candidate: null, notice: 'candidateHidden' };
    }
    return next;
}
