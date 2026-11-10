import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeAtomicSync } from '@adecore/utils/fs';
import type { MachineMode } from '@ruimte/desktop-bridge';
import {
    isoWeekOf,
    isUsageDesktopCounter,
    USAGE_DESKTOP_COUNTERS,
    USAGE_MAX_COUNT,
    USAGE_MAX_DAYS_PER_BATCH,
    USAGE_REPORT_MAX_BYTES,
    UsageDesktopBatchSchema,
    UsageDesktopDaySchema,
    usageDateOf,
    type UsageDesktopBatch,
    type UsageDesktopCounter,
    type UsageDesktopDay
} from '@ruimte/pulsar';
import { z } from 'zod';

const DAY_MS = 86_400_000;
// Today and every finished day a batch may still carry.
const KEPT_DAYS = USAGE_MAX_DAYS_PER_BATCH + 1;
const PERSIST_MS = 60_000;
const SEND_TIMEOUT_MS = 10_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const DaySchema = z.object({
    date: z.string().regex(DATE),
    version: z.string(),
    signedIn: z.boolean(),
    firstThisWeek: z.boolean(),
    firstThisMonth: z.boolean(),
    counts: z.record(z.string(), z.number().int().min(0))
});

const StateSchema = z.object({
    version: z.literal(1),
    firstDate: z.string().regex(DATE).nullable(),
    lastWeek: z.string().nullable(),
    lastMonth: z.string().nullable(),
    // The app's version at its last start, so a start on another one is an update that was installed.
    appVersion: z.string().nullable(),
    days: z.array(DaySchema)
});

type UsageState = z.infer<typeof StateSchema>;
type DesktopUsageDay = z.infer<typeof DaySchema>;

export interface DesktopUsageStore {
    read(): string | null;
    write(text: string): void;
}

/* In the shell's `userData`, where no page reads. */
export function fileDesktopUsageStore(path: string): DesktopUsageStore {
    return {
        read: () => {
            try {
                return readFileSync(path, 'utf8');
            } catch {
                return null;
            }
        },
        write: (text) => {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            writeAtomicSync(path, text);
        }
    };
}

/*
 * The machine's switch (`usageStats` in `endpoint.json`), which is absent while on. Null while the
 * machine wrote no file yet or one that does not read, so nothing counts before there is a switch.
 */
export function usageSettingOf(text: string | null): boolean | null {
    if (text === null) {
        return null;
    }
    try {
        const parsed = JSON.parse(text) as { usageStats?: unknown } | null;
        return typeof parsed === 'object' && parsed !== null ? parsed.usageStats !== false : null;
    } catch {
        return null;
    }
}

interface UsageGateFacts {
    // A release build (`telemetryBuild`); a checkout, `bun dev` and a local build count nothing.
    release: boolean;
    mode: MachineMode;
    setting: boolean | null;
}

/* Only a release with a machine of its own counts, and only while that machine's switch is on; without a machine there is no switch. */
export function usageCounts(facts: UsageGateFacts): boolean {
    return facts.release && facts.mode === 'local' && facts.setting === true;
}

interface DesktopUsageOptions {
    store: DesktopUsageStore;
    version: string;
    // Asked at every count; off drops the days kept, as the machine's own counts do.
    enabled(): boolean;
    now?: () => number;
    schedule?: (run: () => void, ms: number) => () => void;
}

function unrefSchedule(run: () => void, ms: number): () => void {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
}

const EMPTY_STATE: UsageState = { version: 1, firstDate: null, lastWeek: null, lastMonth: null, appVersion: null, days: [] };

/*
 * The app's anonymous usage, counted in memory per UTC day and written at most once a minute and on
 * quit. It keeps today and the seven days before it, the first day it counted (for the cohort) and the
 * last week and month it counted in, the way the machine's counter does (`apps/server/src/stats`).
 */
export class DesktopUsage {
    private readonly options: DesktopUsageOptions;
    private readonly now: () => number;
    private readonly schedule: (run: () => void, ms: number) => () => void;
    private state: UsageState = structuredClone(EMPTY_STATE);
    private pending: (() => void) | null = null;

    constructor(options: DesktopUsageOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.schedule = options.schedule ?? unrefSchedule;
    }

    /* A file that will not read starts the counts over. */
    load(): void {
        const text = this.options.store.read();
        if (text === null) {
            return;
        }
        try {
            const parsed = StateSchema.safeParse(JSON.parse(text));
            if (parsed.success) {
                this.state = parsed.data;
            }
        } catch {
            // Starts over, as a file in another shape does.
        }
    }

    get firstDate(): string | null {
        return this.state.firstDate;
    }

    count(counter: UsageDesktopCounter): void {
        if (!this.counting()) {
            return;
        }
        const day = this.today();
        day.counts[counter] = (day.counts[counter] ?? 0) + 1;
        this.dirty();
    }

    /* A start in a machine mode, and an update when the version moved since the last one. The version is kept with the switch off too. */
    started(mode: MachineMode): void {
        const previous = this.state.appVersion;
        if (previous !== this.options.version) {
            this.state.appVersion = this.options.version;
            this.dirty();
        }
        if (mode === 'ask') {
            return;
        }
        this.count(`starts.${mode}`);
        if (previous !== null && previous !== this.options.version) {
            this.count('updates.installed');
        }
    }

    /* A day counts as signed in once the app held a session at any moment of it. */
    noteSignedIn(signedIn: boolean): void {
        if (!this.counting() || !signedIn) {
            return;
        }
        const day = this.today();
        if (!day.signedIn) {
            day.signedIn = true;
            this.dirty();
        }
    }

    /* The finished days still kept, newest first; never today, which is still counting. */
    finished(): DesktopUsageDay[] {
        const today = usageDateOf(this.now());
        return this.state.days.filter((day) => day.date < today).toSorted((one, other) => other.date.localeCompare(one.date));
    }

    forget(dates: readonly string[]): void {
        const gone = new Set(dates);
        this.state.days = this.state.days.filter((day) => !gone.has(day.date));
        this.dirty();
    }

    /* Every day kept, for a switch that went off. The last week and month go with them, so the day it comes back on is a first of both again. */
    discard(): void {
        if (this.state.days.length === 0 && this.state.lastWeek === null && this.state.lastMonth === null) {
            return;
        }
        this.state.days = [];
        this.state.lastWeek = null;
        this.state.lastMonth = null;
        this.persist();
    }

    persist(): void {
        this.pending?.();
        this.pending = null;
        try {
            this.options.store.write(JSON.stringify(this.state));
        } catch (e) {
            console.warn('Writing the usage counts failed:', e instanceof Error ? e.message : e);
        }
    }

    /* Whether the switch lets a count in now; off it also drops what was kept. */
    counting(): boolean {
        if (this.options.enabled()) {
            return true;
        }
        this.discard();
        return false;
    }

    private dirty(): void {
        this.pending ??= this.schedule(() => {
            this.pending = null;
            this.persist();
        }, PERSIST_MS);
    }

    private today(): DesktopUsageDay {
        const now = this.now();
        const date = usageDateOf(now);
        const kept = this.state.days.find((day) => day.date === date);
        if (kept !== undefined) {
            return kept;
        }
        const week = isoWeekOf(date);
        const month = date.slice(0, 7);
        const day: DesktopUsageDay = {
            date,
            version: this.options.version,
            signedIn: false,
            firstThisWeek: week !== this.state.lastWeek,
            firstThisMonth: month !== this.state.lastMonth,
            counts: {}
        };
        this.state.firstDate ??= date;
        this.state.lastWeek = week;
        this.state.lastMonth = month;
        const oldest = usageDateOf(now - (KEPT_DAYS - 1) * DAY_MS);
        this.state.days = [...this.state.days.filter((other) => other.date >= oldest && other.date < date), day].slice(-KEPT_DAYS);
        return day;
    }
}

/* A name the page handed over; the page is the app's own, but only a name of the list is ever counted. */
export function countFromPage(usage: DesktopUsage, name: unknown): void {
    if (isUsageDesktopCounter(name)) {
        usage.count(name);
    }
}

const COUNTERS: ReadonlySet<string> = new Set(USAGE_DESKTOP_COUNTERS);

function platformOf(platform: string): UsageDesktopDay['platform'] {
    return platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : 'other';
}

function archOf(arch: string): UsageDesktopDay['arch'] {
    return arch === 'arm64' || arch === 'x64' ? arch : 'other';
}

/* The day as the ingest takes it, or null when it never would. A name a newer version wrote and this one does not know is left out. */
export function desktopUsageDayOf(record: DesktopUsageDay, cohortWeek: string, platform: string, arch: string): UsageDesktopDay | null {
    const counts = Object.fromEntries(
        Object.entries(record.counts).flatMap(([name, value]) => (COUNTERS.has(name) && value > 0 ? [[name, Math.min(value, USAGE_MAX_COUNT)]] : []))
    );
    const parsed = UsageDesktopDaySchema.safeParse({
        date: record.date,
        version: record.version,
        platform: platformOf(platform),
        arch: archOf(arch),
        launcher: 'desktop',
        signedIn: record.signedIn,
        firstThisWeek: record.firstThisWeek,
        firstThisMonth: record.firstThisMonth,
        cohortWeek,
        counts
    });
    return parsed.success ? parsed.data : null;
}

/* Newest first, as many days as fit in the ingest's size and at most a week per batch. */
function desktopUsageBatchesOf(days: readonly UsageDesktopDay[]): UsageDesktopBatch[] {
    const batches: UsageDesktopDay[][] = [];
    for (const day of days) {
        const last = batches.at(-1);
        if (last !== undefined && last.length < USAGE_MAX_DAYS_PER_BATCH && batchBytes([...last, day]) <= USAGE_REPORT_MAX_BYTES) {
            last.push(day);
        } else {
            batches.push([day]);
        }
    }
    return batches.map((batch) => ({ days: batch }));
}

function batchBytes(days: readonly UsageDesktopDay[]): number {
    return new TextEncoder().encode(JSON.stringify({ days })).byteLength;
}

export class UsageSendError extends Error {
    readonly status: number;

    constructor(status: number) {
        super(`The usage ingest answered ${status}`);
        this.status = status;
    }
}

/* Straight to Observatory, with no token or key of the app, so nothing ties a day to an install. */
export async function sendDesktopUsage(url: string, batch: UsageDesktopBatch, send: typeof fetch): Promise<void> {
    const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new UsageSendError(response.status);
    }
}

interface FlushOptions {
    send(batch: UsageDesktopBatch): Promise<void>;
    signedIn(): Promise<boolean>;
    platform: string;
    arch: string;
}

/*
 * Sends the finished days once each. A 400 drops a batch too, since it would never be taken; any other
 * failure keeps the days for the next flush, until they are too old to keep.
 */
export async function flushDesktopUsage(usage: DesktopUsage, options: FlushOptions): Promise<void> {
    if (!usage.counting()) {
        return;
    }
    usage.noteSignedIn(await options.signedIn().catch(() => false));
    const records = usage.finished();
    const firstDate = usage.firstDate;
    if (records.length === 0 || firstDate === null) {
        return;
    }
    const cohortWeek = isoWeekOf(firstDate);
    const days = records.flatMap((record) => desktopUsageDayOf(record, cohortWeek, options.platform, options.arch) ?? []);
    const unsendable = records.filter((record) => !days.some((day) => day.date === record.date)).map((record) => record.date);
    if (unsendable.length > 0) {
        usage.forget(unsendable);
    }
    for (const candidate of desktopUsageBatchesOf(days)) {
        const batch = UsageDesktopBatchSchema.safeParse(candidate);
        if (!batch.success) {
            continue;
        }
        const dates = batch.data.days.map((day) => day.date);
        try {
            await options.send(batch.data);
            usage.forget(dates);
        } catch (e) {
            if (e instanceof UsageSendError && e.status === 400) {
                usage.forget(dates);
                continue;
            }
            console.warn('Could not send the usage counts; they wait for the next try:', e instanceof Error ? e.message : e);
            break;
        }
    }
    usage.persist();
}
