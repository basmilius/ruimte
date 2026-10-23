import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isNotFound, writeAtomic } from '@adecore/agents';
import {
    isoWeekOf,
    usageDateOf,
    usageReportCounterOfV1,
    USAGE_MAX_DAYS_PER_BATCH,
    USAGE_REPORT_COUNTERS,
    USAGE_REPORT_TIMINGS,
    type UsageCounter as UsageCounterV1,
    type UsageReportCounter,
    type UsageReportTiming
} from '@ruimte/pulsar';
import { z } from 'zod';
import { errorText } from '../error-text.ts';
import type { Launcher } from '../telemetry/reporter.ts';

const DAY_MS = 86_400_000;
// Today and every finished day a batch may still carry.
const KEPT_DAYS = USAGE_MAX_DAYS_PER_BATCH + 1;
const PERSIST_MS = 60_000;
// A median needs only a handful; a desktop restarted in a loop must not grow the file.
const MAX_SAMPLES = 32;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const REPORT_COUNTERS: ReadonlySet<string> = new Set(USAGE_REPORT_COUNTERS);
const REPORT_TIMINGS: ReadonlySet<string> = new Set(USAGE_REPORT_TIMINGS);

// A day kept before 0.22 has no `timings` and its counters under their old names; `load` renames them.
const DaySchema = z.object({
    date: z.string().regex(DATE),
    version: z.string(),
    launcher: z.enum(['service', 'desktop', 'standalone']),
    signedIn: z.boolean(),
    firstThisWeek: z.boolean(),
    firstThisMonth: z.boolean(),
    startups: z.array(z.number()),
    timings: z.record(z.string(), z.array(z.number())).optional(),
    counts: z.record(z.string(), z.number().int().min(0))
});

const StateSchema = z.object({
    version: z.literal(1),
    firstDate: z.string().regex(DATE).nullable(),
    lastWeek: z.string().nullable(),
    lastMonth: z.string().nullable(),
    days: z.array(DaySchema)
});

type UsageState = Omit<z.infer<typeof StateSchema>, 'days'> & { days: UsageDayRecord[] };

/* One UTC day of counts and timing samples, with what describes the machine that day. */
export type UsageDayRecord = Omit<z.infer<typeof DaySchema>, 'counts' | 'timings'> & {
    counts: Partial<Record<UsageReportCounter, number>>;
    timings: Partial<Record<UsageReportTiming, number[]>>;
};

/* A day as an older version kept it, under the report's names; a counter without one, such as a verb group, is dropped. */
function currentDay(day: z.infer<typeof DaySchema>): UsageDayRecord {
    const { timings, counts, ...description } = day;
    const current: UsageDayRecord = { ...description, counts: {}, timings: {} };
    for (const [name, value] of Object.entries(counts)) {
        const counter = REPORT_COUNTERS.has(name) ? (name as UsageReportCounter) : usageReportCounterOfV1(name as UsageCounterV1);
        if (counter !== null) {
            current.counts[counter] = (current.counts[counter] ?? 0) + value;
        }
    }
    for (const [name, samples] of Object.entries(timings ?? {})) {
        if (REPORT_TIMINGS.has(name)) {
            current.timings[name as UsageReportTiming] = samples.slice(0, MAX_SAMPLES);
        }
    }
    return current;
}

export interface UsageStateStore {
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
}

/* Machine state: no client's file request reaches it (`fs/machine-home.ts`). */
export function usageStatePath(home: string): string {
    return join(home, 'usage', 'stats.json');
}

export function fileUsageStore(path: string): UsageStateStore {
    return {
        read: async () => {
            try {
                return await readFile(path, 'utf8');
            } catch (e) {
                if (isNotFound(e)) {
                    return null;
                }
                throw e;
            }
        },
        write: async (text) => {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeAtomic(path, text, 0o600);
        }
    };
}

export interface UsageCounterOptions {
    store: UsageStateStore;
    // What the day is tagged with when it starts: a day that spans an update keeps the version it began on.
    describe(): { version: string; launcher: Launcher };
    now?: () => number;
    schedule?: (run: () => void, ms: number) => () => void;
}

function systemSchedule(run: () => void, ms: number): () => void {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
}

/*
 * The machine's anonymous usage, counted in memory per UTC day and written at most once a minute. It
 * keeps today and the seven days before it, the first day it ever counted (for the cohort) and the
 * last week and month it was active in, so a day knows whether it is the first of either.
 */
export class UsageCounter {
    private readonly options: UsageCounterOptions;
    private readonly now: () => number;
    private readonly schedule: (run: () => void, ms: number) => () => void;
    private state: UsageState = { version: 1, firstDate: null, lastWeek: null, lastMonth: null, days: [] };
    private current: UsageDayRecord | null = null;
    private currentStart = 0;
    // What `countOnce` already counted on the day of `current`; never written, so a restart may count a key again.
    private seen = new Set<string>();
    private seenDate: string | null = null;
    private pending: (() => void) | null = null;

    constructor(options: UsageCounterOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.schedule = options.schedule ?? systemSchedule;
    }

    /* A file that will not read starts the counts over; they are worth less than a daemon that starts. */
    async load(): Promise<void> {
        let text: string | null;
        try {
            text = await this.options.store.read();
        } catch (e) {
            console.warn('The usage counts would not read; counting starts over:', errorText(e));
            return;
        }
        if (text === null) {
            return;
        }
        try {
            const parsed = StateSchema.safeParse(JSON.parse(text));
            if (parsed.success) {
                this.state = { ...parsed.data, days: parsed.data.days.map(currentDay) };
                return;
            }
        } catch {
            // Read as unreadable below.
        }
        console.warn('The usage counts are not in a shape this version reads; counting starts over');
    }

    /* The day of the machine's first count, as `YYYY-MM-DD`; null before it counted anything. */
    get firstDate(): string | null {
        return this.state.firstDate;
    }

    count(counter: UsageReportCounter, by = 1): void {
        const day = this.today();
        day.counts[counter] = (day.counts[counter] ?? 0) + by;
        this.dirty();
    }

    /* Counts `key` once per UTC day under `counter`; the key stays on this machine and goes with the day. */
    countOnce(counter: UsageReportCounter, key: string): void {
        const day = this.today();
        if (this.seenDate !== day.date) {
            this.seen.clear();
            this.seenDate = day.date;
        }
        const mark = `${counter}\n${key}`;
        if (this.seen.has(mark)) {
            return;
        }
        this.seen.add(mark);
        this.count(counter);
    }

    /* Marks today as a day the machine ran, without counting anything in it. */
    touch(): void {
        this.today();
        this.dirty();
    }

    startup(ms: number): void {
        const day = this.today();
        if (day.startups.length < MAX_SAMPLES) {
            day.startups.push(ms);
            this.dirty();
        }
    }

    /* One sample of a timing, in milliseconds; the day sends their median. */
    sample(timing: UsageReportTiming, ms: number): void {
        const day = this.today();
        const samples = (day.timings[timing] ??= []);
        if (samples.length < MAX_SAMPLES) {
            samples.push(ms);
            this.dirty();
        }
    }

    /* A day counts as signed in once the machine was on an account at any moment of it. */
    noteSignedIn(signedIn: boolean): void {
        const day = this.today();
        if (signedIn && !day.signedIn) {
            day.signedIn = true;
            this.dirty();
        }
    }

    /* The finished days still kept, newest first; never today, which is still counting. */
    finished(): UsageDayRecord[] {
        const today = this.today().date;
        return this.state.days.filter((day) => day.date < today).toSorted((one, other) => other.date.localeCompare(one.date));
    }

    /* Drops days that went out or will never go out. */
    forget(dates: readonly string[]): void {
        const gone = new Set(dates);
        this.state.days = this.state.days.filter((day) => !gone.has(day.date));
        if (this.current !== null && gone.has(this.current.date)) {
            this.current = null;
        }
        this.dirty();
    }

    /*
     * Every day kept, today's too, for when a person turns the counts off. The cohort stays; the last
     * week and month go with the days, so the day the counts come back on is a first of both again.
     */
    async discard(): Promise<void> {
        this.state.days = [];
        this.state.lastWeek = null;
        this.state.lastMonth = null;
        this.current = null;
        this.seen.clear();
        this.seenDate = null;
        await this.persist();
    }

    async persist(): Promise<void> {
        this.pending?.();
        this.pending = null;
        try {
            await this.options.store.write(JSON.stringify(this.state));
        } catch (e) {
            console.warn('Writing the usage counts failed:', errorText(e));
        }
    }

    private dirty(): void {
        this.pending ??= this.schedule(() => {
            this.pending = null;
            void this.persist();
        }, PERSIST_MS);
    }

    private today(): UsageDayRecord {
        const now = this.now();
        if (this.current !== null && now >= this.currentStart && now < this.currentStart + DAY_MS) {
            return this.current;
        }
        return this.openDay(now);
    }

    private openDay(now: number): UsageDayRecord {
        const date = usageDateOf(now);
        this.currentStart = Date.parse(`${date}T00:00:00Z`);
        const kept = this.state.days.find((day) => day.date === date);
        if (kept !== undefined) {
            this.current = kept;
            return kept;
        }
        const week = isoWeekOf(date);
        const month = date.slice(0, 7);
        const { version, launcher } = this.options.describe();
        const day: UsageDayRecord = {
            date,
            version,
            launcher,
            signedIn: false,
            firstThisWeek: week !== this.state.lastWeek,
            firstThisMonth: month !== this.state.lastMonth,
            startups: [],
            timings: {},
            counts: {}
        };
        this.state.firstDate ??= date;
        this.state.lastWeek = week;
        this.state.lastMonth = month;
        const oldest = usageDateOf(now - (KEPT_DAYS - 1) * DAY_MS);
        this.state.days = [...this.state.days.filter((other) => other.date >= oldest && other.date < date), day]
            .toSorted((one, other) => one.date.localeCompare(other.date))
            .slice(-KEPT_DAYS);
        this.current = day;
        return day;
    }
}
