import { describe, expect, test } from 'bun:test';
import type { ChartModel } from './chart';
import {
    barAxis,
    barGroups,
    comparisonModels,
    effortSegments,
    initialSelection,
    measuredEfforts,
    metricChange,
    modelPoints,
    pointDifference,
    pointKey,
    reduceComparison,
    sortedPoints
} from './comparison';

const MODELS: ChartModel[] = [
    {
        id: 'haiku',
        name: 'Haiku 5.5',
        provider: 'claude',
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
        legacy: true,
        points: [
            { effort: 'off', intelligence: 30, costPerTask: 0.02 },
            { effort: 'thinking', intelligence: 35, costPerTask: 0.3 }
        ]
    },
    { id: 'empty', name: 'No data', provider: 'codex', legacy: false, points: [] }
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
            expect(before.at(0)).toBe(0);
            expect(after.ticks).toEqual(before.ticks);
            expect(after.at(0.4)).toBe(before.at(0.4));
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

    test('compares B minus A in score points and B over A in cost', () => {
        expect(pointDifference({ effort: 'low', intelligence: 40, costPerTask: 0.2 }, { effort: 'high', intelligence: 46, costPerTask: 0.5 })).toEqual({
            score: 6,
            costRatio: 2.5
        });
        expect(pointDifference({ effort: 'high', intelligence: 46, costPerTask: 0.5 }, { effort: 'low', intelligence: 40, costPerTask: 0.2 })).toEqual({
            score: -6,
            costRatio: 0.4
        });
    });

    test('rejects undefined ratios and nonfinite values without rejecting a zero score', () => {
        const point = { effort: 'low', intelligence: 0, costPerTask: 0 };
        expect(pointDifference(point, point)).toEqual({ score: 0, costRatio: null });
        expect(pointDifference({ ...point, costPerTask: Infinity }, point).costRatio).toBeNull();
        expect(pointDifference({ ...point, costPerTask: 1 }, { ...point, costPerTask: Infinity }).costRatio).toBeNull();
        expect(pointDifference(point, { ...point, intelligence: NaN }).score).toBeNull();
    });
});
