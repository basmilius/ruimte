import type { BenchmarkMeasurement, BenchmarkModel, ModelBenchmarksResult } from '@ruimte/pulsar';
import { z } from 'zod';
import { BENCHMARK_MODELS } from './benchmark-models.ts';
import type { Env } from './env.ts';
import { failure, json } from './http.ts';

// https://artificialanalysis.ai/data-api/docs
const MODELS_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
export const MAX_PAGES = 10;

const MeasuredModelSchema = z.object({
    id: z.string(),
    evaluations: z
        .object({
            artificial_analysis_intelligence_index: z.number().nullish(),
            artificial_analysis_coding_index: z.number().nullish(),
            artificial_analysis_agentic_index: z.number().nullish()
        })
        .nullish(),
    artificial_analysis_intelligence_index_cost: z
        .object({
            total_cost: z.number().nullish(),
            cost_per_task: z.object({ total_cost: z.number().nullish() }).nullish()
        })
        .nullish(),
    performance: z.object({ median_output_tokens_per_second: z.number().nullish() }).nullish()
});

const ModelsPageSchema = z.object({
    intelligence_index_version: z.number().optional(),
    pagination: z.object({ has_more: z.boolean() }),
    data: z.array(z.unknown())
});

type Measurement = Omit<BenchmarkMeasurement, 'modelId' | 'effort'>;
interface Measurements {
    measurements: Map<string, Measurement>;
    intelligenceIndexVersion?: number;
}

export function measurementsOf(raw: unknown): (Measurements & { hasMore: boolean }) | null {
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
        const evaluations = model.data.evaluations;
        const costs = model.data.artificial_analysis_intelligence_index_cost;
        const values: Measurement = {};
        for (const [field, value] of [
            ['intelligence', evaluations?.artificial_analysis_intelligence_index],
            ['coding', evaluations?.artificial_analysis_coding_index],
            ['agentic', evaluations?.artificial_analysis_agentic_index],
            ['costPerTask', costs?.cost_per_task?.total_cost],
            ['totalCost', costs?.total_cost],
            ['outputSpeed', model.data.performance?.median_output_tokens_per_second]
        ] as const) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                continue;
            }
            if ((field === 'costPerTask' || field === 'totalCost') && value < 0) {
                continue;
            }
            if (field === 'outputSpeed' && value <= 0) {
                continue;
            }
            values[field] = value;
        }
        if (Object.keys(values).length > 0) {
            measurements.set(model.data.id, values);
        }
    }
    return { measurements, hasMore: page.data.pagination.has_more, intelligenceIndexVersion: page.data.intelligence_index_version };
}

/* A failed or truncated refresh must not replace the complete cached snapshot. */
async function fetchMeasurements(apiKey: string): Promise<Measurements | null> {
    const measurements = new Map<string, Measurement>();
    let intelligenceIndexVersion: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await fetch(`${MODELS_URL}?page=${page}`, {
            headers: { 'x-api-key': apiKey, accept: 'application/json' },
            signal: AbortSignal.timeout(15_000)
        }).catch(() => null);
        if (!response?.ok) {
            console.error('benchmarks: page failed', page, response?.status ?? 'network');
            return null;
        }
        const parsed = measurementsOf(await response.json().catch(() => null));
        if (parsed === null || (page > 1 && parsed.intelligenceIndexVersion !== intelligenceIndexVersion)) {
            console.error('benchmarks: inconsistent page', page);
            return null;
        }
        intelligenceIndexVersion = parsed.intelligenceIndexVersion;
        for (const [id, measurement] of parsed.measurements) {
            measurements.set(id, measurement);
        }
        if (!parsed.hasMore) {
            return { measurements, intelligenceIndexVersion };
        }
    }
    return null;
}

export function benchmarksFrom(
    measurements: ReadonlyMap<string, Measurement>,
    fetchedAt: number,
    intelligenceIndexVersion?: number
): ModelBenchmarksResult | null {
    const details: BenchmarkMeasurement[] = [];
    const models: BenchmarkModel[] = BENCHMARK_MODELS.map((model) => ({
        id: model.slug,
        name: model.name,
        provider: model.provider,
        legacy: model.legacy,
        points: model.efforts.flatMap((entry) => {
            const measured = entry.id === null ? undefined : measurements.get(entry.id);
            if (measured === undefined) {
                return [];
            }
            details.push({ modelId: model.slug, effort: entry.effort, ...measured });
            // The original payload stays valid for clients that only know the logarithmic cost chart.
            return measured.intelligence === undefined || measured.costPerTask === undefined || measured.costPerTask <= 0
                ? []
                : [{ effort: entry.effort, intelligence: measured.intelligence, costPerTask: measured.costPerTask }];
        })
    }));
    return details.length > 0
        ? { fetchedAt, models, measurements: details, ...(intelligenceIndexVersion === undefined ? {} : { intelligenceIndexVersion }) }
        : null;
}

export async function refreshBenchmarks(env: Env): Promise<ModelBenchmarksResult | null> {
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return null;
    }
    const snapshot = await fetchMeasurements(env.ARTIFICIAL_ANALYSIS_API_KEY);
    const result = snapshot === null ? null : benchmarksFrom(snapshot.measurements, Date.now(), snapshot.intelligenceIndexVersion);
    if (result === null) {
        return null;
    }
    await env.DB.prepare(
        'INSERT INTO model_benchmarks (id, fetched_at, models, details) VALUES (1, ?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, models = excluded.models, details = excluded.details'
    )
        .bind(
            result.fetchedAt,
            JSON.stringify(result.models),
            JSON.stringify({ measurements: result.measurements, intelligenceIndexVersion: result.intelligenceIndexVersion })
        )
        .run();
    return result;
}

export async function readBenchmarks(env: Env): Promise<Response> {
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return failure('not-configured', 'Model benchmarks are not configured on this address book yet');
    }
    const row = await env.DB.prepare('SELECT fetched_at, models, details FROM model_benchmarks WHERE id = 1').first<{
        fetched_at: number;
        models: string;
        details: string | null;
    }>();
    if (!row) {
        return failure('no-benchmarks', 'The address book has not fetched any model benchmarks yet');
    }
    return json({
        fetchedAt: row.fetched_at,
        models: JSON.parse(row.models) as BenchmarkModel[],
        ...(row.details === null ? {} : JSON.parse(row.details))
    } satisfies ModelBenchmarksResult);
}
