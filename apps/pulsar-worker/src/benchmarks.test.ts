import { describe, expect, test } from 'bun:test';
import { BenchmarkPointSchema, ModelBenchmarksResultSchema } from '@ruimte/pulsar';
import { benchmarkSources, benchmarksFrom, measurementsOf, type BenchmarkSource } from './benchmarks.ts';
import { seedStatementsOf } from './catalog-seed.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

const LOW = 'aa-haiku-low';
const HIGH = 'aa-haiku-high';

const MODEL: BenchmarkSource = {
    slug: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    provider: 'claude',
    legacy: false,
    efforts: [
        { effort: 'low', id: LOW, name: 'Claude Haiku 5.5 (Low)' },
        { effort: 'high', id: HIGH, name: 'Claude Haiku 5.5 (High)' }
    ]
};
const SOURCES = [MODEL];

function page(data: unknown[]) {
    return { intelligence_index_version: 4.3, pagination: { has_more: false }, data };
}

describe('benchmark measurements', () => {
    test('retains each Free-tier metric independently and drops unrelated fields', () => {
        const parsed = measurementsOf(
            page([
                {
                    id: LOW,
                    release_date: '2026-03-12',
                    evaluations: {
                        artificial_analysis_intelligence_index: 0,
                        artificial_analysis_coding_index: 24,
                        artificial_analysis_agentic_index: 30,
                        artificial_analysis_engineering_index: 18,
                        artificial_analysis_legal_index: 40
                    },
                    artificial_analysis_intelligence_index_cost: { total_cost: 50, cost_per_task: null },
                    performance: { median_output_tokens_per_second: 80, median_end_to_end_response_time_seconds: 3 },
                    performance_v3: { mean_output_tokens_per_second: 125, mean_time_to_first_token_seconds: 0.5, mean_time_to_first_answer_token_seconds: 1 },
                    pricing: { price_1m_output_tokens: 1 }
                }
            ])
        );
        expect(parsed?.measurements.get(LOW)).toEqual({
            intelligence: 0,
            engineering: 18,
            totalCost: 50,
            outputSpeed: 125,
            timeToFirstToken: 0.5,
            timeToFirstAnswer: 1,
            responseTime: 5,
            outputPrice: 1,
            releaseDate: '2026-03-12'
        });
        expect(parsed?.intelligenceIndexVersion).toBe(4.3);
    });

    test('never substitutes zero for a missing cost, score or speed', () => {
        const parsed = measurementsOf(
            page([
                {
                    id: LOW,
                    evaluations: { artificial_analysis_engineering_index: 0 },
                    performance_v3: { mean_output_tokens_per_second: 0, mean_time_to_first_answer_token_seconds: null }
                },
                { id: HIGH, artificial_analysis_intelligence_index_cost: { total_cost: -1, cost_per_task: { total_cost: -1 } } },
                { id: 'empty', release_date: '2026-01-01' },
                { id: 'undated', evaluations: { artificial_analysis_intelligence_index: 20 }, release_date: 'January 2026' },
                { id: 'misdated', evaluations: { artificial_analysis_intelligence_index: 30 }, release_date: '2026-02-30' }
            ])
        );
        expect(parsed?.measurements.get(LOW)).toEqual({ engineering: 0 });
        expect(parsed?.measurements.get('undated')).toEqual({ intelligence: 20 });
        // A day the calendar does not have is left out, since a client refuses the whole list over one.
        expect(parsed?.measurements.get('misdated')).toEqual({ intelligence: 30 });
        expect(parsed?.measurements.has(HIGH)).toBe(false);
        expect(parsed?.measurements.has('empty')).toBe(false);
    });

    test('delivers first-answer latency and token prices independently of missing Engineering scores', () => {
        const parsed = measurementsOf(
            page([
                {
                    id: LOW,
                    evaluations: { artificial_analysis_intelligence_index: 42.3, artificial_analysis_engineering_index: null },
                    performance_v3: {
                        mean_output_tokens_per_second: null,
                        mean_time_to_first_token_seconds: 0.1,
                        mean_time_to_first_answer_token_seconds: 12.5
                    },
                    pricing: { price_1m_input_tokens: 4, price_1m_output_tokens: 20, price_1m_cache_hit_tokens: 0, price_1m_cache_write_tokens: null }
                }
            ])
        )!;
        const result = benchmarksFrom(SOURCES, parsed.measurements, 123);
        expect(result.measurements).toEqual([
            {
                modelId: MODEL.slug,
                effort: 'low',
                intelligence: 42.3,
                timeToFirstToken: 0.1,
                timeToFirstAnswer: 12.5,
                inputPrice: 4,
                outputPrice: 20,
                cacheReadPrice: 0
            }
        ]);
        expect(ModelBenchmarksResultSchema.safeParse(result).success).toBe(true);
    });

    test('retains zero latency and free tokens, and omits negative measurements', () => {
        const parsed = measurementsOf(
            page([
                {
                    id: LOW,
                    performance_v3: { mean_output_tokens_per_second: -1, mean_time_to_first_answer_token_seconds: 0 },
                    pricing: { price_1m_input_tokens: 0, price_1m_output_tokens: -1, price_1m_cache_hit_tokens: -1, price_1m_cache_write_tokens: 0 }
                }
            ])
        )!;
        expect(parsed.measurements.get(LOW)).toEqual({ timeToFirstAnswer: 0, inputPrice: 0, cacheWritePrice: 0 });
    });

    test('delivers partial Haiku measurements while preserving the original client contract', () => {
        const result = benchmarksFrom(
            SOURCES,
            new Map([
                [LOW, { intelligence: 30, engineering: 25, outputSpeed: 120 }],
                [HIGH, { intelligence: 40, costPerTask: 0.12, totalCost: 230, engineering: 42 }]
            ]),
            123,
            4.3
        );
        expect(result.models.find((model) => model.id === MODEL.slug)?.points).toEqual([{ effort: 'high', intelligence: 40, costPerTask: 0.12 }]);
        expect(result.measurements?.find((point) => point.modelId === MODEL.slug && point.effort === 'low')).toEqual({
            modelId: MODEL.slug,
            effort: 'low',
            intelligence: 30,
            engineering: 25,
            outputSpeed: 120
        });
        expect(result.models.flatMap((model) => model.points).every((point) => BenchmarkPointSchema.safeParse(point).success)).toBe(true);
        expect(ModelBenchmarksResultSchema.safeParse(result).success).toBe(true);
    });

    test('a zero cost is retained for linear charts but excluded from old logarithmic charts', () => {
        const result = benchmarksFrom(SOURCES, new Map([[LOW, { intelligence: 0, costPerTask: 0 }]]), 123);
        expect(result.models.find((model) => model.id === MODEL.slug)?.points).toEqual([]);
        expect(result.measurements?.[0]?.costPerTask).toBe(0);
    });

    test('accepts old cached responses without the additional metrics', () => {
        expect(ModelBenchmarksResultSchema.safeParse({ fetchedAt: 123, models: [] }).success).toBe(true);
        expect(benchmarksFrom(SOURCES, new Map([['unknown', { intelligence: 40 }]]), 123).measurements).toEqual([]);
        expect(measurementsOf({ data: [] })).toBeNull();
    });
});

describe('the models of the comparison', () => {
    function databaseWith(...kinds: Array<[string, unknown]>): D1Database {
        const database = migratedDatabase();
        database.transaction(() => {
            for (const [kind, catalog] of kinds) {
                for (const statement of seedStatementsOf(kind, catalog as never)) {
                    database.exec(statement);
                }
            }
        })();
        return d1(database);
    }

    const catalogOf = (slugs: Array<[string, boolean]>) => ({
        defaultModel: slugs[0]![0],
        profiles: { plain: { options: [], contextWindowTokens: {} } },
        models: slugs.map(([slug, legacy]) => ({ slug, name: slug.toUpperCase(), profile: 'plain', ...(legacy ? { legacy } : {}) }))
    });

    test('take name and legacy from the catalog, keep the order of the efforts, and group by lab', async () => {
        const db = databaseWith(
            ['grok', catalogOf([['grok-a', false]])],
            [
                'claude',
                catalogOf([
                    ['claude-a', false],
                    ['claude-b', true]
                ])
            ],
            ['copilot', catalogOf([['copilot-a', false]])]
        );
        const insert = (kind: string, slug: string, effort: string, position: number, id: string | null) =>
            db
                .prepare('INSERT INTO model_catalog_benchmarks (kind, slug, effort, position, source_id, source_name) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(kind, slug, effort, position, id, id === null ? null : `${id} name`)
                .run();
        await insert('grok', 'grok-a', 'high', 0, 'aa-grok');
        await insert('claude', 'claude-b', 'max', 1, 'aa-b-max');
        await insert('claude', 'claude-b', 'low', 0, null);
        await insert('claude', 'claude-a', 'high', 0, 'aa-a');
        await insert('copilot', 'copilot-a', 'high', 0, 'aa-copilot');

        expect(await benchmarkSources(db)).toEqual([
            { slug: 'claude-a', name: 'CLAUDE-A', provider: 'claude', legacy: false, efforts: [{ effort: 'high', id: 'aa-a', name: 'aa-a name' }] },
            {
                slug: 'claude-b',
                name: 'CLAUDE-B',
                provider: 'claude',
                legacy: true,
                efforts: [
                    { effort: 'low', id: null, name: null },
                    { effort: 'max', id: 'aa-b-max', name: 'aa-b-max name' }
                ]
            },
            { slug: 'grok-a', name: 'GROK-A', provider: 'xai', legacy: false, efforts: [{ effort: 'high', id: 'aa-grok', name: 'aa-grok name' }] }
        ]);
    });

    test('an effort names both the id and the name of its measurement, or neither', async () => {
        const db = databaseWith(['claude', catalogOf([['claude-a', false]])]);
        const insert = db.prepare(
            "INSERT INTO model_catalog_benchmarks (kind, slug, effort, position, source_id, source_name) VALUES ('claude', 'claude-a', 'high', 0, 'aa-a', NULL)"
        );

        await expect(insert.run()).rejects.toThrow();
    });
});
