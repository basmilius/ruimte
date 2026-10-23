import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { usageReportOfV1, type UsageDay, type UsageReportBatch } from '@ruimte/pulsar';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';
import { USAGE_BATCHES_PER_IP_PER_DAY, acceptUsage, rateLimitCleanup, usageRelay, type UsageDeps } from './usage.ts';

const NOW = Date.parse('2026-10-16T09:30:00Z');
const IP = '192.0.2.7';

let sqlite: Database;
let relayed: UsageReportBatch[];
let burstAllows: boolean;
let deps: UsageDeps;

function day(overrides: Partial<UsageDay> = {}): UsageDay {
    return {
        date: '2026-10-15',
        version: '0.19.0',
        platform: 'linux',
        arch: 'x64',
        launcher: 'standalone',
        signedIn: false,
        firstThisWeek: false,
        firstThisMonth: false,
        cohortWeek: '2026-W41',
        counts: { terminalsStarted: 4, chatsClaude: 1 },
        ...overrides
    };
}

function post(body: unknown, ip = IP): Request {
    return new Request('https://pulsar.test/v1/usage', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
    return ((await response.json()) as { error: { code: string; message: string } }).error;
}

beforeEach(() => {
    sqlite = migratedDatabase();
    relayed = [];
    burstAllows = true;
    deps = {
        db: d1(sqlite),
        burst: { limit: async () => ({ success: burstAllows }) },
        relay: (batch) => relayed.push(batch),
        now: () => NOW
    };
});

describe('a usage batch', () => {
    test('goes on to Observatory whole, days outside the window included, under the report names', async () => {
        const days = [day(), day({ date: '2026-10-07' })];
        expect((await acceptUsage(post({ days }), deps)).status).toBe(204);
        expect(relayed).toEqual([usageReportOfV1({ days })]);
        expect(relayed[0]!.days[0]!.counts).toEqual({ 'terminals.started': 4, 'chats.claude': 1 });
    });

    test('is refused when it carries anything the schema does not name', async () => {
        const response = await acceptUsage(post({ days: [day()], machineId: 'abc' }), deps);
        expect(response.status).toBe(400);
        expect((await errorOf(response)).code).toBe('bad-request');
        expect(relayed).toEqual([]);
    });

    test('is refused while the per-minute limit holds, before it is read', async () => {
        burstAllows = false;
        const response = await acceptUsage(post({ days: [day()] }), deps);
        expect(response.status).toBe(429);
        expect(relayed).toEqual([]);
    });

    test('is refused past the daily cap of an address, and another address still sends', async () => {
        for (let i = 0; i < USAGE_BATCHES_PER_IP_PER_DAY; i++) {
            expect((await acceptUsage(post({ days: [day()] }), deps)).status).toBe(204);
        }
        expect((await acceptUsage(post({ days: [day()] }), deps)).status).toBe(429);
        expect((await acceptUsage(post({ days: [day()] }, '198.51.100.3'), deps)).status).toBe(204);
    });

    test('never stores the address itself', async () => {
        await acceptUsage(post({ days: [day()] }), deps);
        const buckets = sqlite.query('SELECT bucket FROM rate_limit').all() as { bucket: string }[];
        expect(buckets).toHaveLength(1);
        expect(buckets[0]!.bucket).toStartWith('usage:');
        expect(buckets[0]!.bucket).not.toContain(IP);
    });

    test('is not taken while no relay is configured', async () => {
        const response = await acceptUsage(post({ days: [day()] }), { ...deps, relay: undefined });
        expect(response.status).toBe(503);
    });
});

describe('the relay to Observatory', () => {
    test('posts with the upload token after the answer, and a failure leaves the answer alone', async () => {
        const sent: Request[] = [];
        const pending: Promise<unknown>[] = [];
        const send = async (url: string, init: RequestInit): Promise<Response> => {
            sent.push(new Request(url, init));
            throw new Error('down');
        };
        const relay = usageRelay(
            { url: 'https://ingest.test/api/3/usage/?sentry_key=key', token: 'obs_token' },
            (promise) => pending.push(promise),
            send as typeof fetch
        );
        const response = await acceptUsage(post({ days: [day()] }), { ...deps, relay });
        expect(response.status).toBe(204);
        expect(pending).toHaveLength(1);
        await Promise.all(pending);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.url).toBe('https://ingest.test/api/3/usage/?sentry_key=key');
        expect(sent[0]!.headers.get('authorization')).toBe('Bearer obs_token');
        expect(await sent[0]!.json()).toEqual(usageReportOfV1({ days: [day()] }));
    });
});

describe('the cleanup of rate limit buckets', () => {
    test('keeps a usage bucket through its day and a minute bucket for an hour', async () => {
        const midnight = Date.parse('2026-10-16T00:00:00Z');
        const insert = sqlite.query('INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, 1)');
        insert.run('usage:today', midnight);
        insert.run('usage:yesterday', midnight - 86_400_000);
        insert.run('ip:x:login', NOW - 30 * 60_000);
        insert.run('ip:x:old', NOW - 2 * 60 * 60_000);
        await deps.db.batch(rateLimitCleanup(deps.db, NOW));
        const left = (sqlite.query('SELECT bucket FROM rate_limit ORDER BY bucket').all() as { bucket: string }[]).map((row) => row.bucket);
        expect(left).toEqual(['ip:x:login', 'usage:today']);
    });
});
