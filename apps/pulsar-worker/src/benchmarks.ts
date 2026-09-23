import type { BenchmarkModel, BenchmarkPoint, ModelBenchmarksResult } from '@ruimte/pulsar';
import { z } from 'zod';
import { BENCHMARK_MODELS } from './benchmark-models.ts';
import type { Env } from './env.ts';
import { failure, json } from './http.ts';

// https://artificialanalysis.ai/data-api/docs
const MODELS_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';

// A page holds 200 models and there are four today; this only keeps a `has_more` that never ends from spending the day's 100 requests.
export const MAX_PAGES = 10;

/*
 * Only the fields the chart draws, each allowed to be missing or null, since a model can have its index
 * without a cost. Zod drops every other field, so nothing else from the answer reaches the row.
 */
const MeasuredModelSchema = z.object({
    id: z.string(),
    evaluations: z.object({ artificial_analysis_intelligence_index: z.number().nullish() }).nullish(),
    artificial_analysis_intelligence_index_cost: z.object({ cost_per_task: z.object({ total_cost: z.number().nullish() }).nullish() }).nullish()
});

const ModelsPageSchema = z.object({
    pagination: z.object({ has_more: z.boolean() }),
    data: z.array(z.unknown())
});

type Measurement = Omit<BenchmarkPoint, 'effort'>;

/* The measurements of one page by id, or null when the page is not the shape the documentation promises. */
export const measurementsOf = (raw: unknown): { measurements: Map<string, Measurement>; hasMore: boolean } | null => {
    const page = ModelsPageSchema.safeParse(raw);
    if (!page.success) {
        return null;
    }
    const measurements = new Map<string, Measurement>();
    for (const entry of page.data.data) {
        const model = MeasuredModelSchema.safeParse(entry);
        if (!model.success) {
            continue;
        }
        const intelligence = model.data.evaluations?.artificial_analysis_intelligence_index;
        const costPerTask = model.data.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost;
        // A cost of zero has no place on a logarithmic axis, and no run costs nothing.
        if (typeof intelligence === 'number' && typeof costPerTask === 'number' && costPerTask > 0) {
            measurements.set(model.data.id, { intelligence, costPerTask });
        }
    }
    return { measurements, hasMore: page.data.pagination.has_more };
};

/* Every page, or null as soon as one fails, so a half answer never replaces a whole one. */
const fetchMeasurements = async (apiKey: string): Promise<Map<string, Measurement> | null> => {
    const all = new Map<string, Measurement>();
    for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await fetch(`${MODELS_URL}?page=${page}`, { headers: { 'x-api-key': apiKey, accept: 'application/json' } }).catch(() => null);
        if (!response?.ok) {
            console.error('benchmarks: page failed', page, response?.status ?? 'network');
            return null;
        }
        const parsed = measurementsOf(await response.json().catch(() => null));
        if (parsed === null) {
            console.error('benchmarks: page did not parse', page);
            return null;
        }
        for (const [id, measurement] of parsed.measurements) {
            all.set(id, measurement);
        }
        if (!parsed.hasMore) {
            break;
        }
    }
    return all;
};

/* What the route hands out, or null when not one effort of any model in the table was measured. */
export const benchmarksFrom = (measurements: ReadonlyMap<string, Measurement>, fetchedAt: number): ModelBenchmarksResult | null => {
    const models: BenchmarkModel[] = BENCHMARK_MODELS.map((model) => ({
        id: model.slug,
        name: model.name,
        provider: model.provider,
        legacy: model.legacy,
        points: model.efforts.flatMap((entry) => {
            const measured = entry.id === null ? undefined : measurements.get(entry.id);
            return measured === undefined ? [] : [{ effort: entry.effort, intelligence: measured.intelligence, costPerTask: measured.costPerTask }];
        })
    }));
    return models.some((model) => model.points.length > 0) ? { fetchedAt, models } : null;
};

/* The scheduled refresh. Anything short of a whole, recognizable answer leaves the row that is there. */
export const refreshBenchmarks = async (env: Env): Promise<void> => {
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return;
    }
    const measurements = await fetchMeasurements(env.ARTIFICIAL_ANALYSIS_API_KEY);
    const result = measurements === null ? null : benchmarksFrom(measurements, Date.now());
    if (result === null) {
        return;
    }
    await env.DB.prepare(
        'INSERT INTO model_benchmarks (id, fetched_at, models) VALUES (1, ?1, ?2) ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, models = excluded.models'
    )
        .bind(result.fetchedAt, JSON.stringify(result.models))
        .run();
};

export const readBenchmarks = async (env: Env): Promise<Response> => {
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return failure('not-configured', 'Model benchmarks are not configured on this address book yet');
    }
    const row = await env.DB.prepare('SELECT fetched_at, models FROM model_benchmarks WHERE id = 1').first<{ fetched_at: number; models: string }>();
    if (!row) {
        return failure('no-benchmarks', 'The address book has not fetched any model benchmarks yet');
    }
    return json({ fetchedAt: row.fetched_at, models: JSON.parse(row.models) as BenchmarkModel[] } satisfies ModelBenchmarksResult);
};
