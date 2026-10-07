import { describe, expect, test } from 'bun:test';
import { BenchmarkPointSchema, ModelBenchmarksResultSchema } from '@ruimte/pulsar';
import { BENCHMARK_MODELS } from './benchmark-models.ts';
import { benchmarksFrom, measurementsOf } from './benchmarks.ts';

const MODEL = BENCHMARK_MODELS.find((model) => model.slug === 'claude-haiku-5-5')!;
const LOW = MODEL.efforts.find((entry) => entry.effort === 'low')!.id!;
const HIGH = MODEL.efforts.find((entry) => entry.effort === 'high')!.id!;

function page(data: unknown[]) {
    return { intelligence_index_version: 4.3, pagination: { has_more: false }, data };
}

describe('benchmark measurements', () => {
    test('retains each Free-tier metric independently and drops unrelated fields', () => {
        const parsed = measurementsOf(
            page([
                {
                    id: LOW,
                    evaluations: { artificial_analysis_intelligence_index: 0, artificial_analysis_coding_index: 24, artificial_analysis_agentic_index: null },
                    artificial_analysis_intelligence_index_cost: { total_cost: 50, cost_per_task: null },
                    performance: { median_output_tokens_per_second: 125, median_end_to_end_response_time_seconds: 3 },
                    pricing: { price_1m_output_tokens: 1 }
                }
            ])
        );
        expect(parsed?.measurements.get(LOW)).toEqual({ intelligence: 0, coding: 24, totalCost: 50, outputSpeed: 125 });
        expect(parsed?.intelligenceIndexVersion).toBe(4.3);
    });

    test('never substitutes zero for a missing cost, score or speed', () => {
        const parsed = measurementsOf(
            page([
                { id: LOW, evaluations: { artificial_analysis_coding_index: 0 }, performance: { median_output_tokens_per_second: 0 } },
                { id: HIGH, artificial_analysis_intelligence_index_cost: { total_cost: -1, cost_per_task: { total_cost: -1 } } },
                { id: 'empty' }
            ])
        );
        expect(parsed?.measurements.get(LOW)).toEqual({ coding: 0 });
        expect(parsed?.measurements.has(HIGH)).toBe(false);
        expect(parsed?.measurements.has('empty')).toBe(false);
    });

    test('delivers partial Haiku measurements while preserving the original client contract', () => {
        const result = benchmarksFrom(
            new Map([
                [LOW, { intelligence: 30, coding: 25, outputSpeed: 120 }],
                [HIGH, { intelligence: 40, costPerTask: 0.12, totalCost: 230, agentic: 42 }]
            ]),
            123,
            4.3
        )!;
        expect(result.models.find((model) => model.id === MODEL.slug)?.points).toEqual([{ effort: 'high', intelligence: 40, costPerTask: 0.12 }]);
        expect(result.measurements?.find((point) => point.modelId === MODEL.slug && point.effort === 'low')).toEqual({
            modelId: MODEL.slug,
            effort: 'low',
            intelligence: 30,
            coding: 25,
            outputSpeed: 120
        });
        expect(result.models.flatMap((model) => model.points).every((point) => BenchmarkPointSchema.safeParse(point).success)).toBe(true);
        expect(ModelBenchmarksResultSchema.safeParse(result).success).toBe(true);
    });

    test('a zero cost is retained for linear charts but excluded from old logarithmic charts', () => {
        const result = benchmarksFrom(new Map([[LOW, { intelligence: 0, costPerTask: 0 }]]), 123)!;
        expect(result.models.find((model) => model.id === MODEL.slug)?.points).toEqual([]);
        expect(result.measurements?.[0]?.costPerTask).toBe(0);
    });

    test('accepts old cached responses without the additional metrics', () => {
        expect(ModelBenchmarksResultSchema.safeParse({ fetchedAt: 123, models: [] }).success).toBe(true);
        expect(benchmarksFrom(new Map([['unknown', { intelligence: 40 }]]), 123)).toBeNull();
        expect(measurementsOf({ data: [] })).toBeNull();
    });
});
