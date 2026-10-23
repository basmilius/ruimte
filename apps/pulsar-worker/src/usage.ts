import { UsageBatchSchema, usageDateOf, usageReportOfV1, type UsageReportBatch } from '@ruimte/pulsar';
import { clientIp, failure, noContent, readBody } from './http.ts';
import { countUsageRelay } from './metrics.ts';

// Seven days with every counter at its cap stay under 12 KB.
const MAX_USAGE_BODY_BYTES = 32 * 1024;

/*
 * A machine sends one batch a day, and machines behind one address share it. The platform binding only
 * counts per minute, so a day's cap is kept in D1 beside it.
 */
export const USAGE_BATCHES_PER_IP_PER_DAY = 20;

const DAY_MS = 86_400_000;
export const USAGE_BUCKET_PREFIX = 'usage:';

export interface UsageDeps {
    db: D1Database;
    burst?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    // Hands an accepted batch on to Observatory after the answer; absent until it is configured, and then the route answers `not-configured`.
    relay?: (batch: UsageReportBatch) => void;
    now: () => number;
}

export interface UsageRelayConfig {
    // Observatory's usage ingest of the daemon app, with its `sentry_key`.
    url: string;
    // An upload token of the product, which tells Observatory this address book limits per address itself.
    token: string;
}

/*
 * Fire and forget: the machine already has its answer, so a relay that fails only loses those days in
 * Observatory. Only the status is logged, never the batch.
 */
export function usageRelay(
    config: UsageRelayConfig,
    waitUntil: (promise: Promise<unknown>) => void,
    send: typeof fetch = fetch
): (batch: UsageReportBatch) => void {
    return (batch) => {
        const delivery = send(config.url, {
            method: 'POST',
            headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
            body: JSON.stringify(batch)
        })
            .then((response) => {
                countUsageRelay(response.ok ? 'accepted' : String(response.status));
                if (!response.ok) {
                    console.warn('usage relay refused', response.status);
                }
            })
            .catch(() => {
                countUsageRelay('failed');
                console.warn('usage relay failed');
            });
        waitUntil(delivery);
    };
}

/* The day's bucket of an address: a digest, so the table never holds the address itself, and gone after the day. */
async function bucketOf(ip: string, now: number): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pulsar-usage-ip-v1\n${usageDateOf(now)}\n${ip}`));
    return `${USAGE_BUCKET_PREFIX}${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}

async function overDailyLimit(db: D1Database, ip: string, now: number): Promise<boolean> {
    const row = await db
        .prepare(
            'INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count'
        )
        .bind(await bucketOf(ip, now), now - (now % DAY_MS))
        .first<{ count: number }>();
    return row !== null && row.count > USAGE_BATCHES_PER_IP_PER_DAY;
}

function rateLimited(): Response {
    return failure('rate-limited', 'Too many usage batches from this address today', { 'retry-after': '3600' });
}

/*
 * TODO(Bas): remove `/v1/usage`, `usageRelay`, the usage buckets and `USAGE_LIMIT` once 0.23.0 is out;
 * from 0.22.0 on a daemon sends straight to Observatory, and only older ones still come here.
 *
 * `POST /v1/usage`: finished days of anonymous counts, kept nowhere here. Neither the address nor the body
 * is logged. A body the schema refuses is refused whole, so after either answer a machine forgets every day
 * it sent. The relay gets the batch whole, since Observatory skips a day outside its window itself, under the
 * names of the report a newer daemon sends.
 */
export async function acceptUsage(request: Request, deps: UsageDeps): Promise<Response> {
    if (!deps.relay) {
        return failure('not-configured', 'Usage statistics are not collected here');
    }
    const ip = clientIp(request);
    if (deps.burst && !(await deps.burst.limit({ key: ip })).success) {
        return rateLimited();
    }
    const now = deps.now();
    if (await overDailyLimit(deps.db, ip, now)) {
        return rateLimited();
    }
    const body = await readBody(request, UsageBatchSchema, MAX_USAGE_BODY_BYTES);
    if ('response' in body) {
        return body.response;
    }
    deps.relay(usageReportOfV1(body.value));
    return noContent();
}

/* What the daily cleanup drops: a usage bucket once its day is over, every other bucket an hour after its minute. */
export function rateLimitCleanup(db: D1Database, now: number): ReturnType<D1Database['prepare']>[] {
    return [
        db.prepare("DELETE FROM rate_limit WHERE bucket NOT LIKE 'usage:%' AND window_start < ?1").bind(now - 60 * 60_000),
        db.prepare("DELETE FROM rate_limit WHERE bucket LIKE 'usage:%' AND window_start < ?1").bind(now - (now % DAY_MS))
    ];
}
