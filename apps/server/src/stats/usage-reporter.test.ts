import { beforeEach, describe, expect, test } from 'bun:test';
import { USAGE_REPORT_MAX_BYTES, UsageReportBatchSchema as UsageBatchSchema, type UsageReportBatch as UsageBatch, type UsageReportDay } from '@ruimte/pulsar';
import { UsageCounter, type UsageStateStore } from './usage-counter.ts';
import { sendToObservatory, usageBatchesOf, UsageReporter, UsageSendError, usageDayOf } from './usage-reporter.ts';

const DAY = 86_400_000;
const MINUTE = 60_000;

let clock: number;
let sent: UsageBatch[];
let answer: () => Promise<void>;
let enabled: boolean;

const store: UsageStateStore = { read: async () => null, write: async () => undefined };

function counterOf(): UsageCounter {
    return new UsageCounter({ store, describe: () => ({ version: '1.2.3', launcher: 'service' }), now: () => clock, schedule: () => () => undefined });
}

function reporterOf(counter: UsageCounter): UsageReporter {
    return new UsageReporter({
        counter,
        enabled: () => enabled,
        signedIn: async () => true,
        now: () => clock,
        send: (batch) => {
            sent.push(batch);
            return answer();
        }
    });
}

beforeEach(() => {
    clock = Date.parse('2026-10-14T10:00:00Z');
    sent = [];
    answer = async () => undefined;
    enabled = true;
});

describe('sending the usage counts', () => {
    test('sends the finished days once, as the address book takes them', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('projects.opened');
        counter.startup(900);
        counter.startup(1500);
        counter.startup(1200);
        await reporter.flush();
        expect(sent).toEqual([]);

        clock += DAY;
        await reporter.flush();
        expect(sent).toHaveLength(1);
        expect(UsageBatchSchema.safeParse(sent[0]).success).toBe(true);
        expect(sent[0]!.days).toEqual([
            {
                date: '2026-10-14',
                version: '1.2.3',
                platform: expect.any(String),
                arch: expect.any(String),
                launcher: 'service',
                signedIn: true,
                firstThisWeek: true,
                firstThisMonth: true,
                cohortWeek: '2026-W42',
                startupMs: 1200,
                counts: { 'projects.opened': 1 }
            }
        ]);

        await reporter.flush();
        expect(sent).toHaveLength(1);
    });

    test('keeps the days after a failure and tries again ten minutes later', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launches.run');
        clock += DAY;
        answer = () => Promise.reject(new TypeError('fetch failed'));
        await reporter.flush();
        expect(sent).toHaveLength(1);

        clock += 5 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(1);

        answer = () => Promise.reject(new UsageSendError(503, null));
        clock += 6 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(2);

        answer = async () => undefined;
        clock += 11 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(3);
        expect(counter.finished()).toEqual([]);
    });

    test('drops the days the ingest refused with 400', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launches.run');
        clock += DAY;
        answer = () => Promise.reject(new UsageSendError(400, null));
        await reporter.flush();
        expect(counter.finished()).toEqual([]);
    });

    test('waits out a Retry-After longer than ten minutes, then sends again', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launches.run');
        clock += DAY;
        answer = () => Promise.reject(new UsageSendError(429, 60 * MINUTE));
        await reporter.flush();

        answer = async () => undefined;
        clock += 30 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(1);

        clock += 31 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(2);
        expect(counter.finished()).toEqual([]);
    });

    test('sends nothing while the switch is off', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launches.run');
        clock += DAY;
        enabled = false;
        await reporter.flush();
        expect(sent).toEqual([]);
    });

    test('never sends a day older than seven days', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launches.run');
        clock += 9 * DAY;
        await reporter.flush();
        expect(sent).toEqual([]);
    });
});

describe('a day as the address book takes it', () => {
    const record = {
        date: '2026-10-14',
        version: '1.2.3',
        launcher: 'desktop' as const,
        signedIn: false,
        firstThisWeek: false,
        firstThisMonth: false,
        startups: [],
        timings: { terminalAttachMs: [40, 90, 60] },
        counts: { 'projects.opened': 250_000, 'launches.run': 0 }
    };

    test('sends one median per timing, beside the startup', () => {
        expect(usageDayOf({ ...record, startups: [900, 1100] }, '2026-W40')).toMatchObject({ startupMs: 1000, timings: { terminalAttachMs: 60 } });
        expect(usageDayOf({ ...record, timings: {} }, '2026-W40')?.timings).toBeUndefined();
    });

    test('clamps a count, leaves out zeros and maps an unknown platform', () => {
        expect(usageDayOf(record, '2026-W40', 'freebsd', 'ia32')).toMatchObject({
            platform: 'other',
            arch: 'other',
            counts: { 'projects.opened': 100_000 }
        });
        expect(usageDayOf(record, '2026-W40', 'linux', 'x64')?.startupMs).toBeUndefined();
    });

    test('is none for a version that is not a release', () => {
        expect(usageDayOf({ ...record, version: 'dev' }, '2026-W40')).toBeNull();
    });
});

describe('days as batches', () => {
    const dayOn = (date: string, counters: number): UsageReportDay => ({
        date,
        version: '1.2.3',
        platform: 'linux',
        arch: 'x64',
        launcher: 'service',
        signedIn: false,
        firstThisWeek: false,
        firstThisMonth: false,
        cohortWeek: '2026-W40',
        counts: Object.fromEntries(['verbs.read', 'verbs.agent', 'chats.claude', 'turns.claude'].slice(0, counters).map((name) => [name, 1]))
    });

    test('go as one batch while they fit, and at most a week each', () => {
        const week = Array.from({ length: 8 }, (_, i) => dayOn(`2026-10-${String(10 + i)}`, 2));
        expect(usageBatchesOf(week).map((batch) => batch.days.length)).toEqual([7, 1]);
    });

    test('split before a batch grows over the size the ingest takes', () => {
        const day = dayOn('2026-10-10', 4);
        const perDay = new TextEncoder().encode(JSON.stringify(day)).byteLength;
        const fit = Math.floor(USAGE_REPORT_MAX_BYTES / perDay);
        const many = Array.from({ length: Math.min(fit + 1, 7) }, (_, i) => ({ ...day, date: `2026-10-${String(10 + i)}` }));
        for (const batch of usageBatchesOf(many)) {
            expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThanOrEqual(USAGE_REPORT_MAX_BYTES);
        }
    });
});

describe('sending to Observatory', () => {
    const batch: UsageBatch = { days: [] };

    test('posts the batch to the daemon app usage ingest without a token', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const send = async (url: string, init: RequestInit): Promise<Response> => {
            calls.push({ url, init });
            return new Response(null, { status: 204 });
        };
        await sendToObservatory(batch, send as typeof fetch);
        expect(calls[0]!.url).toBe('https://ingest.bmnw.nl/api/3/usage/?sentry_key=ace29cdab42746249e5753874d74c401');
        expect(calls[0]!.init.method).toBe('POST');
        expect(new Headers(calls[0]!.init.headers).has('authorization')).toBe(false);
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual(batch);
    });

    test('fails with the status and the Retry-After of an answer other than 2xx', async () => {
        const answerWith = (response: Response) => (async () => response) as unknown as typeof fetch;
        const limited = await sendToObservatory(batch, answerWith(new Response(null, { status: 429, headers: { 'retry-after': '3600' } }))).catch(
            (e: unknown) => e
        );
        expect(limited).toBeInstanceOf(UsageSendError);
        expect(limited).toMatchObject({ status: 429, retryAfterMs: 3_600_000 });
        const refused = await sendToObservatory(batch, answerWith(new Response(null, { status: 400 }))).catch((e: unknown) => e);
        expect(refused).toMatchObject({ status: 400, retryAfterMs: null });
    });
});
