import type { BenchmarkMeasurement, BenchmarkModel, ModelBenchmarksResult } from '@ruimte/pulsar';
import { z } from 'zod';
import { BENCHMARK_LABS, LAB_OF_KIND, type BenchmarkProvider } from './benchmark-labs.ts';
import type { Env } from './env.ts';
import { failure, json } from './http.ts';

// https://artificialanalysis.ai/data-api/docs
const MODELS_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
export const MAX_PAGES = 10;
const RESPONSE_ANSWER_TOKENS = 500;

const MeasuredModelSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    release_date: z.string().nullish(),
    evaluations: z
        .object({
            artificial_analysis_intelligence_index: z.number().nullish(),
            artificial_analysis_engineering_index: z.number().nullish()
        })
        .nullish(),
    artificial_analysis_intelligence_index_cost: z
        .object({
            total_cost: z.number().nullish(),
            cost_per_task: z.object({ total_cost: z.number().nullish() }).nullish()
        })
        .nullish(),
    performance_v3: z
        .object({
            mean_output_tokens_per_second: z.number().nullish(),
            mean_time_to_first_token_seconds: z.number().nullish(),
            mean_time_to_first_answer_token_seconds: z.number().nullish()
        })
        .nullish(),
    pricing: z
        .object({
            price_1m_input_tokens: z.number().nullish(),
            price_1m_output_tokens: z.number().nullish(),
            price_1m_cache_hit_tokens: z.number().nullish(),
            price_1m_cache_write_tokens: z.number().nullish()
        })
        .nullish()
});

const ModelsPageSchema = z.object({
    intelligence_index_version: z.number().optional(),
    pagination: z.object({ has_more: z.boolean() }),
    data: z.array(z.unknown())
});

type Measurement = Omit<BenchmarkMeasurement, 'modelId' | 'effort'>;
interface Measurements {
    measurements: Map<string, Measurement>;
    // What Artificial Analysis calls each measured model, so a person finds the id of a new one in D1.
    names: Map<string, string>;
    intelligenceIndexVersion?: number;
}

export function measurementsOf(raw: unknown): (Measurements & { hasMore: boolean }) | null {
    const page = ModelsPageSchema.safeParse(raw);
    if (!page.success) {
        return null;
    }
    const measurements = new Map<string, Measurement>();
    const names = new Map<string, string>();
    for (const entry of page.data.data) {
        const model = MeasuredModelSchema.safeParse(entry);
        if (!model.success) {
            continue;
        }
        const evaluations = model.data.evaluations;
        const costs = model.data.artificial_analysis_intelligence_index_cost;
        const performance = model.data.performance_v3;
        const pricing = model.data.pricing;
        const values: Measurement = {};
        for (const [field, value] of [
            ['intelligence', evaluations?.artificial_analysis_intelligence_index],
            ['engineering', evaluations?.artificial_analysis_engineering_index],
            ['costPerTask', costs?.cost_per_task?.total_cost],
            ['totalCost', costs?.total_cost],
            ['outputSpeed', performance?.mean_output_tokens_per_second],
            ['timeToFirstToken', performance?.mean_time_to_first_token_seconds],
            ['timeToFirstAnswer', performance?.mean_time_to_first_answer_token_seconds],
            ['inputPrice', pricing?.price_1m_input_tokens],
            ['outputPrice', pricing?.price_1m_output_tokens],
            ['cacheReadPrice', pricing?.price_1m_cache_hit_tokens],
            ['cacheWritePrice', pricing?.price_1m_cache_write_tokens]
        ] as const) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                continue;
            }
            if (field !== 'intelligence' && field !== 'engineering' && value < 0) {
                continue;
            }
            if (field === 'outputSpeed' && value <= 0) {
                continue;
            }
            values[field] = value;
        }
        // performance_v3 has no end-to-end time on the Free tier, so it is derived the way the
        // retired field was measured: the first answer token, then 500 answer tokens.
        if (values.timeToFirstAnswer !== undefined && values.outputSpeed !== undefined) {
            values.responseTime = values.timeToFirstAnswer + RESPONSE_ANSWER_TOKENS / values.outputSpeed;
        }
        if (Object.keys(values).length > 0) {
            const released = model.data.release_date;
            // A real date, as the address book's schema asks: one the calendar does not have would make every client refuse the whole list.
            if (typeof released === 'string' && z.iso.date().safeParse(released).success) {
                values.releaseDate = released;
            }
            measurements.set(model.data.id, values);
            if (model.data.name !== undefined) {
                names.set(model.data.id, model.data.name);
            }
        }
    }
    return { measurements, names, hasMore: page.data.pagination.has_more, intelligenceIndexVersion: page.data.intelligence_index_version };
}

/* A failed or truncated refresh must not replace the complete cached snapshot. */
async function fetchMeasurements(apiKey: string): Promise<Measurements | null> {
    const measurements = new Map<string, Measurement>();
    const names = new Map<string, string>();
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
        for (const [id, name] of parsed.names) {
            names.set(id, name);
        }
        if (!parsed.hasMore) {
            return { measurements, names, intelligenceIndexVersion };
        }
    }
    return null;
}

export type BenchmarkEffort = { effort: string } & ({ id: string; name: string } | { id: null; name: null });

export interface BenchmarkSource {
    slug: string;
    name: string;
    provider: BenchmarkProvider;
    legacy: boolean;
    // In the order the line runs through them, cheapest first.
    efforts: BenchmarkEffort[];
}

interface SourceRow {
    kind: string;
    slug: string;
    effort: string;
    source_id: string | null;
    source_name: string | null;
    name: string;
    legacy: number;
}

/*
 * The models of the comparison from the catalog, with the Artificial Analysis model of each effort. There an effort
 * is a model of its own; ultrathink and ultra have no counterpart above max, and a switch such as Haiku's thinking
 * is two efforts, `off` and the id of the switch. In the order of the labs, then of the picker.
 */
export async function benchmarkSources(db: D1Database): Promise<BenchmarkSource[]> {
    const { results } = await db
        .prepare(
            'SELECT benchmark.kind, benchmark.slug, benchmark.effort, benchmark.source_id, benchmark.source_name, model.name, model.legacy FROM model_catalog_benchmarks AS benchmark JOIN model_catalog_models AS model USING (kind, slug) ORDER BY model.position, benchmark.position'
        )
        .all<SourceRow>();
    const labOrder = BENCHMARK_LABS.map((lab) => lab.id);
    const sources = new Map<string, BenchmarkSource>();
    for (const row of results) {
        const provider = LAB_OF_KIND[row.kind];
        if (provider === undefined) {
            continue;
        }
        const key = `${row.kind}/${row.slug}`;
        const source = sources.get(key) ?? { slug: row.slug, name: row.name, provider, legacy: row.legacy === 1, efforts: [] };
        sources.set(key, source);
        source.efforts.push(
            row.source_id === null || row.source_name === null
                ? { effort: row.effort, id: null, name: null }
                : { effort: row.effort, id: row.source_id, name: row.source_name }
        );
    }
    return [...sources.values()].sort((first, second) => labOrder.indexOf(first.provider) - labOrder.indexOf(second.provider));
}

export function benchmarksFrom(
    sources: readonly BenchmarkSource[],
    measurements: ReadonlyMap<string, Measurement>,
    fetchedAt: number,
    intelligenceIndexVersion?: number
): ModelBenchmarksResult {
    const details: BenchmarkMeasurement[] = [];
    const models: BenchmarkModel[] = sources.map((model) => ({
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
    return { fetchedAt, models, measurements: details, ...(intelligenceIndexVersion === undefined ? {} : { intelligenceIndexVersion }) };
}

export interface BenchmarkRefresh {
    fetchedAt: number;
    // How many models Artificial Analysis measured, mapped or not.
    measured: number;
}

/* Keeps every model the whole fetch measured, so a mapping added later shows without waiting for the next refresh. */
export async function refreshBenchmarks(env: Env): Promise<BenchmarkRefresh | null> {
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return null;
    }
    const snapshot = await fetchMeasurements(env.ARTIFICIAL_ANALYSIS_API_KEY);
    if (snapshot === null || snapshot.measurements.size === 0) {
        return null;
    }
    const fetchedAt = Date.now();
    const measured = JSON.stringify(
        Object.fromEntries([...snapshot.measurements].map(([id, measurement]) => [id, { name: snapshot.names.get(id) ?? null, measurement }]))
    );
    // One batch is one transaction, so a read sees the whole refresh or the one before it.
    await env.DB.batch([
        env.DB.prepare('DELETE FROM benchmark_measurements WHERE source_id NOT IN (SELECT key FROM json_each(?1))').bind(measured),
        env.DB.prepare(
            "INSERT INTO benchmark_measurements (source_id, name, measurement) SELECT key, json_extract(value, '$.name'), json_extract(value, '$.measurement') FROM json_each(?1) WHERE true ON CONFLICT (source_id) DO UPDATE SET name = excluded.name, measurement = excluded.measurement"
        ).bind(measured),
        env.DB.prepare(
            'INSERT INTO benchmark_refreshes (id, fetched_at, intelligence_index_version) VALUES (1, ?1, ?2) ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, intelligence_index_version = excluded.intelligence_index_version'
        ).bind(fetchedAt, snapshot.intelligenceIndexVersion ?? null)
    ]);
    return { fetchedAt, measured: snapshot.measurements.size };
}

export async function readBenchmarks(env: Env): Promise<Response> {
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return failure('not-configured', 'Model benchmarks are not configured on this address book yet');
    }
    const refresh = await env.DB.prepare('SELECT fetched_at, intelligence_index_version FROM benchmark_refreshes WHERE id = 1').first<{
        fetched_at: number;
        intelligence_index_version: number | null;
    }>();
    if (!refresh) {
        return failure('no-benchmarks', 'The address book has not fetched any model benchmarks yet');
    }
    const sources = await benchmarkSources(env.DB);
    const { results } = await env.DB.prepare(
        'SELECT source_id, measurement FROM benchmark_measurements WHERE source_id IN (SELECT source_id FROM model_catalog_benchmarks)'
    ).all<{ source_id: string; measurement: string }>();
    const measurements = new Map(results.map((row) => [row.source_id, JSON.parse(row.measurement) as Measurement]));
    const result = benchmarksFrom(sources, measurements, refresh.fetched_at, refresh.intelligence_index_version ?? undefined);
    // From the code rather than the refresh, so a new lab shows with the deploy instead of the next refresh.
    return json({ ...result, labs: [...BENCHMARK_LABS] } satisfies ModelBenchmarksResult);
}
