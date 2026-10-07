import { toBase64Url } from '@ruimte/pulsar';
import { refreshBenchmarks } from './benchmarks.ts';
import type { Env } from './env.ts';
import { failure, json } from './http.ts';

export async function refreshDeployedBenchmarks(request: Request, env: Env): Promise<Response> {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    const expiresAt = Number(env.BENCHMARK_REFRESH_TOKEN_EXPIRES_AT);
    if (!token || !env.BENCHMARK_REFRESH_TOKEN_HASH || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
        return failure('unauthorized', 'A valid deployment token is required');
    }
    const digest = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
    if (digest !== env.BENCHMARK_REFRESH_TOKEN_HASH) {
        return failure('unauthorized', 'A valid deployment token is required');
    }
    if (!env.ARTIFICIAL_ANALYSIS_API_KEY) {
        return failure('not-configured', 'Model benchmarks are not configured on this address book yet');
    }

    // Consume once before fetching, even if AA fails. Daily rate-limit cleanup removes the expired claim.
    const claim = await env.DB.prepare(
        'INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (bucket, window_start) DO NOTHING RETURNING count'
    )
        .bind(`benchmark-deploy:${digest}`, expiresAt)
        .first<{ count: number }>();
    if (claim === null) {
        return failure('rate-limited', 'This deployment token has already been used');
    }
    const result = await refreshBenchmarks(env);
    if (result === null) {
        return json({ refreshed: false, error: 'Benchmark refresh failed; the previous snapshot was kept' }, 502);
    }
    return json({ refreshed: true, fetchedAt: result.fetchedAt, measurements: result.measurements?.length ?? 0 });
}
