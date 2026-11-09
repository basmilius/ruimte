import {
    dueTimesBetween,
    freeSlug,
    isDeclined,
    isScheduled,
    wallTimeOf,
    zonedTime,
    type RoutineEntry,
    type RoutineRun,
    type RoutineSchedule
} from '@ruimte/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

// A day's noon, so a date written from its midnight never slips to the day before around a clock change.
export const NOON_MS = DAY_MS / 2;

// Every quarter hour of a week, the most a schedule can be due in one.
const WEEK_TIMES_MAX = 7 * 24 * 4;

/* What a block in the week says about its run. `next` and a `paused` without a run are times the client works out from the schedule. */
export type BlockLook = 'done' | 'waited' | 'caught-up' | 'limit' | 'skipped' | 'paused' | 'next' | 'running' | 'waiting' | 'failed';

export const LEGEND: readonly BlockLook[] = ['done', 'running', 'waiting', 'caught-up', 'failed', 'next'];

interface AgendaDay {
    /* Epoch ms of midnight in the machine's time zone, and of the next one. */
    start: number;
    end: number;
    /* `YYYY-MM-DD` in the machine's time zone. */
    date: string;
    /* ISO: 1 is Monday. */
    weekday: number;
}

export interface AgendaWeek {
    days: AgendaDay[];
    start: number;
    end: number;
    /* The ISO week number of its Monday. */
    number: number;
}

export interface AgendaBlock {
    key: string;
    day: number;
    at: number;
    look: BlockLook;
    run: RoutineRun | null;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function isoWeekNumber(year: number, month: number, day: number): number {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    // The Thursday of a week decides its year.
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const firstOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - firstOfYear) / DAY_MS + 1) / 7);
}

/* The week, Monday first, `offset` weeks from the one `now` falls in, by the wall clock of the machine. */
export function weekOf(now: number, timeZone: string, offset: number): AgendaWeek {
    const wall = wallTimeOf(now, timeZone);
    const monday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - (wall.weekday - 1) + offset * 7));
    const days = Array.from({ length: 7 }, (_, index): AgendaDay => {
        const date = new Date(monday.getTime() + index * DAY_MS);
        const next = new Date(date.getTime() + DAY_MS);
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        return {
            start: zonedTime(year, month, day, 0, 0, timeZone),
            end: zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone),
            date: `${year}-${pad(month)}-${pad(day)}`,
            weekday: index + 1
        };
    });
    return {
        days,
        start: days[0]!.start,
        end: days[6]!.end,
        number: isoWeekNumber(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
    };
}

export function lookOfRun(run: RoutineRun): BlockLook {
    switch (run.state) {
        case 'skipped':
            return run.skipped === 'paused' ? 'paused' : 'skipped';
        case 'limit':
            return 'limit';
        case 'needs-you':
            return 'waiting';
        case 'starting':
        case 'running':
            return 'running';
        case 'failed':
            return 'failed';
        case 'done':
            if (run.waited === true) {
                return 'waited';
            }
            return run.kind === 'caught-up' ? 'caught-up' : 'done';
    }
}

function dayIndexOf(week: AgendaWeek, at: number): number {
    return week.days.findIndex((day) => at >= day.start && at < day.end);
}

/*
 * The blocks of one routine in a week: a block per run it had, and its coming times from the schedule.
 * A run sits on the day it was due, so a caught-up run stays on the morning it missed.
 */
export function blocksOf(entry: RoutineEntry, week: AgendaWeek, now: number, timeZone: string): AgendaBlock[] {
    const blocks: AgendaBlock[] = [];
    for (const run of entry.runs) {
        const day = dayIndexOf(week, run.due);
        if (day >= 0) {
            blocks.push({ key: run.runId, day, at: run.due, look: lookOfRun(run), run });
        }
    }
    if (isScheduled(entry) && week.end > now) {
        const taken = new Set(entry.runs.map((run) => run.due));
        const paused = entry.local.pausedAt !== undefined;
        for (const at of dueTimesBetween(entry.routine.schedule, Math.max(now, week.start - 1), week.end - 1, timeZone, WEEK_TIMES_MAX)) {
            if (!taken.has(at)) {
                blocks.push({ key: `next-${at}`, day: dayIndexOf(week, at), at, look: paused ? 'paused' : 'next', run: null });
            }
        }
    }
    return blocks.sort((left, right) => left.at - right.at);
}

// The runs of one day a cell shows as blocks of their own; more fold into one chip so a day of half-hourly runs stays a cell.
const RUNS_PER_CELL = 2;

// A run that asks for a person, or still goes on, keeps its block however many there are.
const STANDS_OUT: ReadonlySet<BlockLook> = new Set(['running', 'waiting', 'limit']);

export type CellItem =
    | { kind: 'block'; key: string; at: number; block: AgendaBlock }
    | { kind: 'runs'; key: string; at: number; blocks: AgendaBlock[]; failed: number }
    | { kind: 'coming'; key: string; at: number; blocks: AgendaBlock[]; every: number; to: string }
    // A cron's times have no one step, so its chip counts them.
    | { kind: 'coming'; key: string; at: number; blocks: AgendaBlock[]; every: null };

function single(block: AgendaBlock): CellItem {
    return { kind: 'block', key: block.key, at: block.at, block };
}

/*
 * What one routine's cell of a day shows. Up to two runs are blocks; past that the quiet ones fold into one
 * chip that lists them. The times still to come of a repeat within a day or a cron are one chip.
 */
export function cellItems(blocks: readonly AgendaBlock[], schedule: RoutineSchedule): CellItem[] {
    const runs = blocks.filter((block) => block.run !== null);
    const coming = blocks.filter((block) => block.run === null);
    const items: CellItem[] = [];
    const quiet = runs.filter((block) => !STANDS_OUT.has(block.look));
    if (runs.length > RUNS_PER_CELL && quiet.length > 1) {
        items.push({
            kind: 'runs',
            key: `runs-${quiet[0]!.key}`,
            at: quiet[0]!.at,
            blocks: quiet,
            failed: quiet.filter((block) => block.look === 'failed').length
        });
        items.push(...runs.filter((block) => STANDS_OUT.has(block.look)).map(single));
    } else {
        items.push(...runs.map(single));
    }
    const comingKey = `coming-${coming[0]?.key}`;
    if (schedule.kind === 'interval' && coming.length > 1) {
        items.push({ kind: 'coming', key: comingKey, at: coming[0]!.at, blocks: coming, every: schedule.every, to: schedule.to });
    } else if (schedule.kind === 'cron' && coming.length > 1) {
        items.push({ kind: 'coming', key: comingKey, at: coming[0]!.at, blocks: coming, every: null });
    } else {
        items.push(...coming.map(single));
    }
    return items.sort((left, right) => left.at - right.at);
}

/*
 * The days of the week a paused routine draws as one band: from today, or the week's first day ahead of
 * now, to its end, past the days that still hold a run. Null when it is not paused or the week is past.
 */
export function pausedBand(entry: RoutineEntry, blocks: readonly AgendaBlock[], week: AgendaWeek, now: number): { from: number; to: number } | null {
    if (entry.local.pausedAt === undefined || !isScheduled(entry) || week.end <= now) {
        return null;
    }
    let from = week.start > now ? 0 : Math.max(0, dayIndexOf(week, now));
    while (from < 7 && blocks.some((block) => block.day === from && block.run !== null)) {
        from++;
    }
    return from > 6 ? null : { from, to: 6 };
}

export function skippedWhilePaused(entry: RoutineEntry): number {
    const since = entry.local.pausedAt;
    if (since === undefined) {
        return 0;
    }
    return entry.runs.filter((run) => run.state === 'skipped' && run.skipped === 'paused' && run.due >= since).length;
}

export function awaitsApproval(entry: RoutineEntry): boolean {
    return entry.held !== undefined && !isDeclined(entry);
}

export function awaitingApproval(entries: readonly RoutineEntry[]): RoutineEntry[] {
    return entries.filter(awaitsApproval);
}

export function runsWaiting(entries: readonly RoutineEntry[]): Array<{ entry: RoutineEntry; run: RoutineRun }> {
    return entries
        .flatMap((entry) => entry.runs.filter((run) => run.state === 'needs-you').map((run) => ({ entry, run })))
        .sort((left, right) => right.run.at - left.run.at);
}

export function freshRoutineId(title: string, taken: ReadonlySet<string>): string {
    return freeSlug(title, 'routine', taken);
}
