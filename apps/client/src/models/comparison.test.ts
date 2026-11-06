import { describe, expect, test } from 'bun:test';
import type { BenchmarkLab } from '@ruimte/pulsar';
import type { ChartModel } from './chart';
import {
    barAxis,
    barGroups,
    comparisonModels,
    effortSegments,
    formatMetric,
    initialSelection,
    measuredEfforts,
    matchesChart,
    lowerIsBetter,
    metricChange,
    modelPoints,
    pointKey,
    reduceComparison,
    sortedPoints
} from './comparison';

function lab(id: string): BenchmarkLab {
    return { id, name: id, logo: { viewBox: '0 0 24 24', path: 'M0 0h24v24H0z' }, colors: { light: ['#000000'], dark: ['#ffffff'] } };
}

const MODELS: ChartModel[] = [
    {
        id: 'haiku',
        name: 'Haiku 5.5',
        provider: 'claude',
        lab: lab('claude'),
        legacy: false,
        points: [
            { effort: 'low', intelligence: 40.04, costPerTask: 0.04 },
            { effort: 'medium', intelligence: 45, costPerTask: 0.12 },
            { effort: 'high', intelligence: 50, costPerTask: 0.25 },
            { effort: 'xhigh', intelligence: 52, costPerTask: 0.45 },
            { effort: 'max', intelligence: 53, costPerTask: 0.8 }
        ]
    },
    {
        id: 'gpt',
        name: 'GPT',
        provider: 'codex',
        lab: lab('codex'),
        legacy: false,
        points: [
            { effort: 'low', intelligence: 40.01, costPerTask: 0.09 },
            { effort: 'high', intelligence: 51, costPerTask: 0.5 }
        ]
    },
    {
        id: 'haiku-old',
        name: 'Haiku 4.5',
        provider: 'claude',
        lab: lab('claude'),
        legacy: true,
        points: [
            { effort: 'off', intelligence: 30, costPerTask: 0.02 },
            { effort: 'thinking', intelligence: 35, costPerTask: 0.3 }
        ]
    },
    { id: 'empty', name: 'No data', provider: 'codex', lab: lab('codex'), legacy: false, points: [] }
];

describe('model comparison selection', () => {
    test('provider controls preserve the other provider and efforts; reset restores the initial view', () => {
        let state = reduceComparison(MODELS, initialSelection(), { type: 'effort', id: 'low' });
        state = reduceComparison(MODELS, state, { type: 'activate', key: pointKey('haiku', 'high') });
        state = reduceComparison(MODELS, state, { type: 'provider', provider: 'claude', show: false });
        expect(comparisonModels(MODELS, state).drawn.map((model) => model.id)).toEqual(['gpt']);
        expect(state).toMatchObject({ reference: null, notice: 'referenceHidden' });
        state = reduceComparison(MODELS, state, { type: 'provider', provider: 'claude', show: true });
        expect(state.hiddenEfforts.has('low')).toBe(true);
        expect(comparisonModels(MODELS, state).drawn.map((model) => model.id)).toEqual(['haiku', 'gpt']);
        expect(reduceComparison(MODELS, state, { type: 'reset' })).toEqual(initialSelection());
    });

    test('current Haiku levels are derived from measurements; legacy thinking is separate', () => {
        const current = comparisonModels(MODELS, initialSelection());
        expect(measuredEfforts(current.listed)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        const legacy = reduceComparison(MODELS, initialSelection(), { type: 'legacy', value: true });
        expect(measuredEfforts(comparisonModels(MODELS, legacy).listed)).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking']);
    });

    test('hidden efforts never deselect a model, even when it has no matching points', () => {
        let state = initialSelection();
        for (const effort of ['low', 'high']) {
            state = reduceComparison(MODELS, state, { type: 'effort', id: effort });
        }
        const filtered = comparisonModels(MODELS, state);
        expect(filtered.drawn.map((model) => model.id)).toEqual(['haiku']);
        expect(filtered.selected.map((model) => model.id)).toContain('gpt');
        expect(filtered.listed.find((model) => model.id === 'gpt')?.points).toHaveLength(2);
        state = reduceComparison(MODELS, state, { type: 'efforts' });
        expect(comparisonModels(MODELS, state).drawn.map((model) => model.id)).toEqual(['haiku', 'gpt']);
    });

    test('empty selections and resets keep the other filter intact', () => {
        let state = reduceComparison(MODELS, initialSelection(), { type: 'model', id: 'gpt' });
        for (const effort of measuredEfforts(MODELS)) {
            state = reduceComparison(MODELS, state, { type: 'effort', id: effort });
        }
        expect(comparisonModels(MODELS, state).drawn).toEqual([]);
        state = reduceComparison(MODELS, state, { type: 'efforts' });
        expect(state.hiddenModels.has('gpt')).toBe(true);
        expect(comparisonModels(MODELS, state).drawn.map((model) => model.id)).toEqual(['haiku']);
        state = reduceComparison(MODELS, state, { type: 'effort', id: 'max' });
        state = reduceComparison(MODELS, state, { type: 'models' });
        expect(state.hiddenEfforts.has('max')).toBe(true);
    });

    test('pins model plus effort and clears only B when B becomes hidden', () => {
        const reference = pointKey('haiku', 'low');
        const candidate = pointKey('gpt', 'high');
        let state = reduceComparison(MODELS, initialSelection(), { type: 'activate', key: reference });
        state = reduceComparison(MODELS, state, { type: 'candidate', key: candidate });
        expect(state).toMatchObject({ reference, candidate });
        state = reduceComparison(MODELS, state, { type: 'model', id: 'gpt' });
        expect(state).toMatchObject({ reference, candidate: null, notice: 'candidateHidden' });
        state = reduceComparison(MODELS, state, { type: 'effort', id: 'low' });
        expect(state).toMatchObject({ reference: null, candidate: null, notice: 'referenceHidden' });
    });

    test('turning legacy off clears a legacy reference without changing effort selections', () => {
        let state = reduceComparison(MODELS, initialSelection(), { type: 'legacy', value: true });
        state = reduceComparison(MODELS, state, { type: 'activate', key: pointKey('haiku-old', 'thinking') });
        state = reduceComparison(MODELS, state, { type: 'effort', id: 'max' });
        state = reduceComparison(MODELS, state, { type: 'legacy', value: false });
        expect(state).toMatchObject({ reference: null, notice: 'referenceHidden' });
        expect(state.hiddenEfforts.has('max')).toBe(true);
    });

    test('clicking A again or clearing keeps model and effort filters', () => {
        for (const clear of ['activate', 'clear'] as const) {
            let state = reduceComparison(MODELS, initialSelection(), { type: 'model', id: 'gpt' });
            state = reduceComparison(MODELS, state, { type: 'effort', id: 'max' });
            state = reduceComparison(MODELS, state, { type: 'activate', key: pointKey('haiku', 'high') });
            state = reduceComparison(MODELS, state, { type: clear, key: pointKey('haiku', 'high') });
            expect(state.reference).toBeNull();
            expect(state.hiddenModels.has('gpt')).toBe(true);
            expect(state.hiddenEfforts.has('max')).toBe(true);
        }
    });
});

describe('comparison chart math', () => {
    test('preserves subsecond latency precision instead of rounding positive measurements to zero', () => {
        expect(formatMetric(0.04, 'timeToFirstAnswer')).toBe('0.04');
        expect(formatMetric(10.23, 'responseTime')).toBe('10.23');
        expect(formatMetric(0, 'timeToFirstAnswer')).toBe('0');
    });

    test('latency frontiers favor lower times while throughput frontiers favor higher speeds', () => {
        expect(lowerIsBetter('timeToFirstAnswer')).toBe(true);
        expect(lowerIsBetter('responseTime')).toBe(true);
        expect(lowerIsBetter('costPerTask')).toBe(true);
        expect(lowerIsBetter('outputSpeed')).toBe(false);
    });

    test('chart availability distinguishes missing metrics from effort and logarithmic filters', () => {
        const models: ChartModel[] = [
            {
                ...MODELS[0]!,
                points: [
                    { effort: 'low', intelligence: 40, timeToFirstAnswer: 0 },
                    { effort: 'high', intelligence: 50, timeToFirstAnswer: 10 }
                ]
            }
        ];
        const state = reduceComparison(models, initialSelection(), { type: 'effort', id: 'high' });
        const filtered = comparisonModels(models, state).drawn[0]!;
        expect(models[0]!.points.some((point) => matchesChart(point, 'coding', false, 'linear'))).toBe(false);
        expect(models[0]!.points.some((point) => matchesChart(point, 'timeToFirstAnswer', true, 'linear'))).toBe(true);
        expect(filtered.points.some((point) => matchesChart(point, 'timeToFirstAnswer', true, 'log'))).toBe(false);
        expect(filtered.points.some((point) => matchesChart(point, 'timeToFirstAnswer', true, 'linear'))).toBe(true);
        expect(matchesChart({ effort: 'low', responseTime: 10 }, 'responseTime', true, 'linear')).toBe(false);
    });

    test('compares latency and token prices by ratio, retaining zero and omitting missing cache prices', () => {
        const one = { effort: 'low', timeToFirstAnswer: 10, inputPrice: 4, cacheReadPrice: 0 };
        const two = { effort: 'high', timeToFirstAnswer: 5, inputPrice: 0 };
        expect(metricChange(one, two, 'timeToFirstAnswer')).toEqual({ value: 0.5, ratio: true });
        expect(metricChange(one, two, 'inputPrice')).toEqual({ value: 0, ratio: true });
        expect(metricChange(two, one, 'inputPrice')).toBeNull();
        expect(metricChange(one, two, 'cacheReadPrice')).toBeNull();
    });

    test('groups models by their maximum value and retains metric-specific partial data, including zero', () => {
        const partial: ChartModel[] = [
            {
                ...MODELS[0]!,
                points: [
                    { effort: 'low', coding: 0 },
                    { effort: 'max', coding: 40, totalCost: 300 }
                ]
            },
            { ...MODELS[1]!, points: [{ effort: 'high', intelligence: 50, coding: 30, totalCost: 100 }] }
        ];
        expect(barGroups(partial, 'coding', true).map((group) => group[0]!.modelId)).toEqual(['haiku', 'gpt']);
        expect(barGroups(partial, 'totalCost', true).map((group) => group[0]!.modelId)).toEqual(['gpt', 'haiku']);
        expect(barGroups(partial, 'coding', false)[0]?.map((point) => point.coding)).toEqual([40, 30, 0]);
        expect(
            barGroups(partial, 'score', true)
                .flat()
                .map((point) => point.modelId)
        ).toEqual(['gpt']);
        expect(barGroups(partial, 'cost', true)).toEqual([]);
    });

    test('uses index point differences and speed ratios without inventing absent values', () => {
        const original = { effort: 'low', coding: 0, outputSpeed: 100 };
        const other = { effort: 'high', coding: 30, outputSpeed: 150 };
        expect(metricChange(original, other, 'coding')).toEqual({ value: 30, ratio: false });
        expect(metricChange(original, other, 'outputSpeed')).toEqual({ value: 1.5, ratio: true });
        expect(metricChange(original, other, 'totalCost')).toBeNull();
        const reference = { effort: 'low', intelligence: 40, costPerTask: 0.2 };
        const candidate = { effort: 'high', intelligence: 46, costPerTask: 0.5 };
        expect(metricChange(reference, candidate, 'intelligence')).toEqual({ value: 6, ratio: false });
        expect(metricChange(candidate, reference, 'intelligence')).toEqual({ value: -6, ratio: false });
        expect(metricChange(reference, candidate, 'costPerTask')).toEqual({ value: 2.5, ratio: true });
        expect(metricChange(candidate, reference, 'costPerTask')).toEqual({ value: 0.4, ratio: true });
        const zero = { effort: 'low', intelligence: 0, costPerTask: 0 };
        expect(metricChange(zero, zero, 'intelligence')).toEqual({ value: 0, ratio: false });
        expect(metricChange(zero, zero, 'costPerTask')).toBeNull();
        expect(metricChange({ ...zero, costPerTask: Infinity }, zero, 'costPerTask')).toBeNull();
        expect(metricChange({ ...zero, costPerTask: 1 }, { ...zero, costPerTask: Infinity }, 'costPerTask')).toBeNull();
        expect(metricChange(zero, { ...zero, intelligence: NaN }, 'intelligence')).toBeNull();
    });

    test('ranks raw values in the metric direction without mutating model order', () => {
        const points = modelPoints(MODELS);
        const scores = sortedPoints(points, 'score');
        expect(scores.findIndex((point) => point.key === pointKey('haiku', 'low'))).toBeLessThan(
            scores.findIndex((point) => point.key === pointKey('gpt', 'low'))
        );
        expect(sortedPoints(points, 'cost')[0]?.key).toBe(pointKey('haiku-old', 'off'));
        expect(points[0]?.key).toBe(pointKey('haiku', 'low'));
        const ties = [points[0]!, { ...points[0]!, key: 'a' }];
        expect(sortedPoints(ties, 'score')).toEqual(sortedPoints([...ties].reverse(), 'score'));
    });

    test('both bar axes start at zero and remain stable when efforts are filtered', () => {
        const initial = comparisonModels(MODELS, initialSelection());
        const filtered = comparisonModels(MODELS, reduceComparison(MODELS, initialSelection(), { type: 'effort', id: 'max' }));
        for (const metric of ['score', 'cost'] as const) {
            const before = barAxis(initial.selected, metric);
            const after = barAxis(filtered.selected, metric);
            const maximum = metric === 'score' ? 60 : 0.8;
            expect(before.ticks.at(0)).toBe(0);
            expect(before.ticks.at(-1)).toBe(maximum);
            expect(after.ticks).toEqual(before.ticks);
        }
    });

    test('does not interpolate a hidden or missing effort', () => {
        const points = MODELS[0]!.points;
        expect(effortSegments(points, points)).toHaveLength(1);
        expect(
            effortSegments(
                points.filter((point) => point.effort !== 'medium'),
                points
            ).map((segment) => segment.map((point) => point.effort))
        ).toEqual([['low'], ['high', 'xhigh', 'max']]);
        expect(effortSegments(MODELS[1]!.points, MODELS[1]!.points)).toHaveLength(2);
        expect(effortSegments(MODELS[2]!.points, MODELS[2]!.points)).toHaveLength(1);
    });
});
