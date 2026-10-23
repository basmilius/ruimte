import { beforeEach, describe, expect, test } from 'bun:test';
import { checkInEnvelope, withCheckIn, type CheckInDeps, type CheckInMonitor } from './check-in.ts';

const MONITOR: CheckInMonitor = { slug: 'pulsar-nightly', schedule: '17 4 * * *', checkinMargin: 5, maxRuntime: 2 };
const INGEST_URL = 'https://ingest.test/api/7/envelope/?sentry_key=key';

let clock: number;
let posted: { url: string; body: string }[];
let pending: Promise<unknown>[];
let failSend: boolean;
let deps: CheckInDeps;

function itemsOf(body: string): unknown[] {
    return body
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown);
}

beforeEach(() => {
    clock = 1_000_000;
    posted = [];
    pending = [];
    failSend = false;
    const send = async (url: string, init: RequestInit): Promise<Response> => {
        posted.push({ url, body: String(init.body) });
        if (failSend) {
            throw new Error('down');
        }
        return new Response(null, { status: 200 });
    };
    deps = { url: INGEST_URL, waitUntil: (promise) => pending.push(promise), send: send as typeof fetch, now: () => clock, id: () => 'abc123' };
});

describe('a check-in envelope', () => {
    test('is an empty header, the item header and the check-in with the monitor configuration', () => {
        expect(itemsOf(checkInEnvelope(MONITOR, 'abc123', 'in_progress'))).toEqual([
            {},
            { type: 'check_in' },
            {
                check_in_id: 'abc123',
                monitor_slug: 'pulsar-nightly',
                status: 'in_progress',
                monitor_config: {
                    schedule: { type: 'crontab', value: '17 4 * * *' },
                    checkin_margin: 5,
                    max_runtime: 2,
                    timezone: 'UTC',
                    failure_issue_threshold: 1,
                    recovery_threshold: 1
                }
            }
        ]);
    });

    test('carries the duration once the run is over', () => {
        expect(itemsOf(checkInEnvelope(MONITOR, 'abc123', 'ok', 1.5))[2]).toMatchObject({ status: 'ok', duration: 1.5 });
    });
});

describe('a run with check-ins', () => {
    test('checks in before and after a run that succeeds, with one id and its duration', async () => {
        await withCheckIn(
            MONITOR,
            async () => {
                clock += 2500;
            },
            deps
        );
        await Promise.all(pending);
        expect(posted.map((post) => post.url)).toEqual([INGEST_URL, INGEST_URL]);
        expect(posted.map((post) => itemsOf(post.body)[2])).toEqual([
            expect.objectContaining({ check_in_id: 'abc123', status: 'in_progress' }),
            expect.objectContaining({ check_in_id: 'abc123', status: 'ok', duration: 2.5 })
        ]);
    });

    test('checks in an error and throws the job error again', async () => {
        const run = withCheckIn(
            MONITOR,
            async () => {
                throw new Error('D1 is gone');
            },
            deps
        );
        await expect(run).rejects.toThrow('D1 is gone');
        await Promise.all(pending);
        expect(itemsOf(posted[1]!.body)[2]).toMatchObject({ status: 'error' });
    });

    test('runs the job whole when every check-in fails to send', async () => {
        failSend = true;
        let ran = false;
        await withCheckIn(
            MONITOR,
            async () => {
                ran = true;
            },
            deps
        );
        await Promise.all(pending);
        expect(ran).toBe(true);
        expect(posted).toHaveLength(2);
    });
});
