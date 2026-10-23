import {
    isoWeekOf,
    USAGE_MAX_COUNT,
    USAGE_MAX_DAYS_PER_BATCH,
    USAGE_MAX_STARTUP_MS,
    USAGE_REPORT_COUNTERS,
    USAGE_REPORT_MAX_BYTES,
    USAGE_REPORT_TIMINGS,
    UsageReportBatchSchema,
    UsageReportDaySchema,
    type UsageReportBatch,
    type UsageReportDay
} from '@ruimte/pulsar';
import { usageIngestUrl } from '@ruimte/telemetry';
import { errorText } from '../error-text.ts';
import type { UsageCounter, UsageDayRecord } from './usage-counter.ts';

// After a failure the ingest is knocked on this often at most, however often a client lists providers.
const RETRY_MS = 10 * 60 * 1000;
// A `Retry-After` is followed up to a day, so an answer that names a far moment never outlives the days it holds back.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;

/* An answer of the ingest other than 2xx; `retryAfterMs` is null without a readable `Retry-After`. */
export class UsageSendError extends Error {
    readonly status: number;
    readonly retryAfterMs: number | null;

    constructor(status: number, retryAfterMs: number | null) {
        super(`The usage ingest answered ${status}`);
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

function retryAfterOf(response: Response): number | null {
    const seconds = Number(response.headers.get('retry-after') ?? '');
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

type Platform = UsageReportDay['platform'];
type Arch = UsageReportDay['arch'];

function platformOf(platform: string): Platform {
    return platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : 'other';
}

function archOf(arch: string): Arch {
    return arch === 'arm64' || arch === 'x64' ? arch : 'other';
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = values.toSorted((one, other) => one - other);
    const middle = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

/* The day as the ingest takes it, or null when it never would. */
export function usageDayOf(
    record: UsageDayRecord,
    cohortWeek: string,
    platform: string = process.platform,
    arch: string = process.arch
): UsageReportDay | null {
    const counts = Object.fromEntries(
        USAGE_REPORT_COUNTERS.flatMap((counter) => {
            const value = record.counts[counter] ?? 0;
            return value > 0 ? [[counter, Math.min(value, USAGE_MAX_COUNT)]] : [];
        })
    );
    const timings = Object.fromEntries(
        USAGE_REPORT_TIMINGS.flatMap((timing) => {
            const value = median(record.timings[timing] ?? []);
            return value === null ? [] : [[timing, clampTiming(value)]];
        })
    );
    const startup = median(record.startups);
    const parsed = UsageReportDaySchema.safeParse({
        date: record.date,
        version: record.version,
        platform: platformOf(platform),
        arch: archOf(arch),
        launcher: record.launcher,
        signedIn: record.signedIn,
        firstThisWeek: record.firstThisWeek,
        firstThisMonth: record.firstThisMonth,
        cohortWeek,
        ...(startup === null ? {} : { startupMs: clampTiming(startup) }),
        counts,
        ...(Object.keys(timings).length === 0 ? {} : { timings })
    });
    return parsed.success ? parsed.data : null;
}

function clampTiming(ms: number): number {
    return Math.min(Math.max(ms, 1), USAGE_MAX_STARTUP_MS);
}

/*
 * The days as batches the ingest takes, newest first: as many days as fit in its size, at most a week. A day too
 * large alone, which a counter of each name would still not make, goes on its own and the ingest decides.
 */
export function usageBatchesOf(days: readonly UsageReportDay[]): UsageReportBatch[] {
    const batches: UsageReportDay[][] = [];
    for (const day of days) {
        const last = batches.at(-1);
        if (last !== undefined && last.length < USAGE_MAX_DAYS_PER_BATCH && usageBatchBytes([...last, day]) <= USAGE_REPORT_MAX_BYTES) {
            last.push(day);
        } else {
            batches.push([day]);
        }
    }
    return batches.map((batch) => ({ days: batch }));
}

function usageBatchBytes(days: readonly UsageReportDay[]): number {
    return new TextEncoder().encode(JSON.stringify({ days })).byteLength;
}

/* Straight to Observatory, never with a token or a key of the machine, so nothing ties a day to an install. */
export async function sendToObservatory(batch: UsageReportBatch, send: typeof fetch = fetch): Promise<void> {
    const response = await send(usageIngestUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new UsageSendError(response.status, retryAfterOf(response));
    }
}

interface UsageReporterOptions {
    counter: UsageCounter;
    // The machine's switch; off sends nothing.
    enabled(): boolean;
    signedIn(): Promise<boolean>;
    send?: (batch: UsageReportBatch) => Promise<void>;
    now?: () => number;
}

/*
 * Sends the finished days the counter keeps, when the daemon starts and whenever a client lists the
 * providers, which is when the model catalogs are fetched too: no clock of its own. A day goes once:
 * an answer of 400 drops it as well, since it would never be taken; any other failure keeps it for
 * the next try, ten minutes on or after the ingest's `Retry-After`, until it is too old to send.
 */
export class UsageReporter {
    private readonly options: UsageReporterOptions;
    private readonly send: (batch: UsageReportBatch) => Promise<void>;
    private readonly now: () => number;
    private failedAt: number | null = null;
    private waitMs = RETRY_MS;
    private inFlight: Promise<void> | null = null;

    constructor(options: UsageReporterOptions) {
        this.options = options;
        this.send = options.send ?? ((batch) => sendToObservatory(batch));
        this.now = options.now ?? Date.now;
    }

    /* One send at a time; a second caller waits for the first one's answer. */
    flush(): Promise<void> {
        this.inFlight ??= this.run().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async run(): Promise<void> {
        if (!this.options.enabled()) {
            return;
        }
        const { counter } = this.options;
        counter.noteSignedIn(await this.options.signedIn().catch(() => false));
        const now = this.now();
        // A time in the future means the clock went back; that failure counts as old.
        if (this.failedAt !== null && now >= this.failedAt && now - this.failedAt < this.waitMs) {
            return;
        }
        const records = counter.finished();
        const firstDate = counter.firstDate;
        if (records.length === 0 || firstDate === null) {
            return;
        }
        const cohortWeek = isoWeekOf(firstDate);
        const days = records.flatMap((record) => {
            const day = usageDayOf(record, cohortWeek);
            return day === null ? [] : [day];
        });
        const unsendable = records.filter((record) => !days.some((day) => day.date === record.date)).map((record) => record.date);
        if (unsendable.length > 0) {
            counter.forget(unsendable);
        }
        for (const candidate of usageBatchesOf(days)) {
            const batch = UsageReportBatchSchema.safeParse(candidate);
            if (!batch.success) {
                continue;
            }
            const dates = batch.data.days.map((day) => day.date);
            try {
                await this.send(batch.data);
                this.failedAt = null;
                counter.forget(dates);
            } catch (e) {
                // A 400 is a body the schema refuses, which sending again cannot fix; a day out of range is skipped with a 204 instead.
                if (e instanceof UsageSendError && e.status === 400) {
                    console.warn('The usage ingest refused the usage counts; they are dropped:', errorText(e));
                    counter.forget(dates);
                    continue;
                }
                this.failedAt = now;
                this.waitMs = Math.max(RETRY_MS, e instanceof UsageSendError ? (e.retryAfterMs ?? 0) : 0);
                console.warn('Could not send the usage counts; they wait for the next try:', errorText(e));
                break;
            }
        }
        await counter.persist();
    }
}
