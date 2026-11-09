import { formatClock, formatDateTime, formatDay, formatDuration, formatElapsedShort } from '@adecore/ui/format';
import { isDeclined, type CronProblem, type RoutineEntry, type RoutineRun, type RoutineSchedule } from '@ruimte/contracts';
import i18next from 'i18next';
import { weekdayWords } from '@/format/weekday';
import { awaitsApproval, type AgendaBlock, type CellItem } from '@/routines/agenda';

/* A time of a schedule, `HH:MM` on the machine's clock, written the way the region writes a clock. */
export function clockWords(time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    return formatClock(Date.UTC(2000, 0, 3, hour ?? 0, minute ?? 0), 'UTC');
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

function sameDays(days: readonly number[], expected: readonly number[]): boolean {
    return days.length === expected.length && expected.every((day) => days.includes(day));
}

function sortedDays(days: readonly number[]): number[] {
    return [...new Set(days)].sort((left, right) => left - right);
}

function daysGroup(days: readonly number[]): 'daily' | 'weekdays' | 'weekends' | null {
    if (days.length === 7) {
        return 'daily';
    }
    if (sameDays(days, WEEKDAYS)) {
        return 'weekdays';
    }
    return sameDays(days, WEEKEND) ? 'weekends' : null;
}

/* `every 15 minutes`, `every hour`, `every 2 hours`. */
export function everyWords(minutes: number): string {
    if (minutes === 60) {
        return i18next.t('routines:step.hour');
    }
    return minutes % 60 === 0 ? i18next.t('routines:step.hours', { count: minutes / 60 }) : i18next.t('routines:step.minutes', { count: minutes });
}

/* The days of a repeat within a day: `Daily`, `Weekdays`, `Monday`, `Mon, Wed`. */
function intervalDayWords(days: readonly number[]): string {
    const group = daysGroup(days);
    if (group !== null) {
        return i18next.t(`routines:repeatDays.${group}`);
    }
    return days.length === 1 ? weekdayWords(days[0]!, 'long') : days.map((day) => weekdayWords(day)).join(', ');
}

/* `Weekdays at 09:00`, `Every Friday at 16:00`, `Once, 26 Oct at 09:00`, `Weekdays, every hour from 09:00 to 17:00`. */
export function scheduleWords(schedule: RoutineSchedule): string {
    if (schedule.kind === 'cron') {
        return i18next.t('routines:repeat.cron', { expression: schedule.expression });
    }
    if (schedule.kind === 'interval') {
        return i18next.t('routines:repeat.interval', {
            days: intervalDayWords(sortedDays(schedule.days)),
            every: everyWords(schedule.every),
            from: clockWords(schedule.from),
            to: clockWords(schedule.to)
        });
    }
    const time = clockWords(schedule.time);
    if (schedule.kind === 'once') {
        const [year, month, day] = schedule.date.split('-').map(Number);
        return i18next.t('routines:repeat.once', { date: formatDay(Date.UTC(year!, month! - 1, day!, 12), 'UTC'), time });
    }
    const days = sortedDays(schedule.days);
    const group = daysGroup(days);
    if (group !== null) {
        return i18next.t(`routines:repeat.${group}`, { time });
    }
    if (days.length === 1) {
        return i18next.t('routines:repeat.every', { day: weekdayWords(days[0]!, 'long'), time });
    }
    return i18next.t('routines:repeat.some', { days: days.map((day) => weekdayWords(day)).join(', '), time });
}

/* Why the form does not take a cron expression yet. */
export function cronProblemWords(problem: CronProblem): string {
    switch (problem.kind) {
        case 'shape':
            return i18next.t('routines:form.cronShape');
        case 'field':
            return i18next.t('routines:form.cronField', { field: i18next.t(`routines:form.cronFields.${problem.field}`), part: problem.part });
        case 'often':
            return i18next.t('routines:form.cronOften');
        case 'never':
            return i18next.t('routines:form.cronNever');
    }
}

export function blockWords(block: AgendaBlock, timeZone: string): string {
    const t = (key: string, values?: Record<string, string>): string => i18next.t(`routines:chip.${key}`, values);
    const run = block.run;
    const time = formatClock(run?.at ?? block.at, timeZone);
    switch (block.look) {
        case 'done':
        case 'waited':
            return run?.endedAt === undefined ? time : t('took', { time, duration: formatElapsedShort(run.endedAt - run.at) });
        case 'waiting':
            return t('needsYou');
        case 'caught-up':
            return t('woke', { time });
        case 'limit':
            return t('limit');
        case 'failed':
            return t('failed');
        case 'skipped':
            return t('skipped');
        case 'paused':
            return t('paused');
        case 'running':
        case 'next':
            return time;
    }
}

/* What a folded chip of a day says: `9 runs · 1 failed`, or `every hour until 17:00` or `5 more until 17:00` for the times still to come. */
export function foldWords(item: Exclude<CellItem, { kind: 'block' }>, timeZone: string): string {
    if (item.kind === 'coming') {
        if (item.every === null) {
            return i18next.t('routines:chip.comingCount', { count: item.blocks.length, to: formatClock(item.blocks[item.blocks.length - 1]!.at, timeZone) });
        }
        return i18next.t('routines:chip.coming', { every: everyWords(item.every), to: clockWords(item.to) });
    }
    const runs = i18next.t('routines:chip.runs', { count: item.blocks.length });
    return item.failed === 0 ? runs : i18next.t('routines:chip.runsFailed', { runs, count: item.failed });
}

/* A moment on the machine's clock with its weekday: `Mon 09:00`. */
export function weekdayClock(at: number, timeZone: string): string {
    return formatDateTime(at, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone });
}

/* The day of a moment on the machine's clock: `Mon 26 Oct`. */
export function dayWords(at: number, timeZone: string): string {
    return formatDateTime(at, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
}

/* The day and time of a moment on the machine's clock: `Mon 26 Oct, 09:00`. */
export function dayClockWords(at: number, timeZone: string): string {
    return formatDateTime(at, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone });
}

export function rowStatus(entry: RoutineEntry, timeZone: string): { tone: 'needs' | 'muted'; text: string } {
    const waiting = entry.runs.find((run) => run.state === 'needs-you');
    if (waiting !== undefined) {
        return { tone: 'needs', text: i18next.t('routines:row.waits', { time: weekdayClock(waiting.at, timeZone) }) };
    }
    if (awaitsApproval(entry)) {
        return { tone: 'needs', text: i18next.t('routines:row.held') };
    }
    if (isDeclined(entry)) {
        return { tone: 'muted', text: i18next.t('routines:row.declined') };
    }
    if (entry.local.pausedAt !== undefined) {
        return { tone: 'muted', text: i18next.t('routines:row.paused') };
    }
    if (entry.next !== null) {
        return { tone: 'muted', text: i18next.t('routines:row.next', { time: weekdayClock(entry.next, timeZone) }) };
    }
    return { tone: 'muted', text: i18next.t('routines:row.ended') };
}

export function runWords(run: RoutineRun, timeZone: string): string {
    const t = (key: string, values?: Record<string, string>): string => i18next.t(`routines:run.${key}`, values);
    const took = (): string => formatDuration(Math.max(0, (run.endedAt ?? run.at) - run.at));
    switch (run.state) {
        case 'skipped':
            return t(run.skipped === 'paused' ? 'skippedPaused' : run.skipped === 'held' ? 'skippedHeld' : 'skippedOverlap');
        case 'starting':
            return t('starting');
        case 'running':
            return t('running', { time: formatClock(run.at, timeZone) });
        case 'needs-you':
            return t('needsYou');
        case 'limit':
            return run.limitUntil === undefined ? t('limit') : t('limitUntil', { time: weekdayClock(run.limitUntil, timeZone) });
        case 'failed':
            if (run.error !== undefined && run.error !== '') {
                return t('failedWith', { error: run.error });
            }
            return run.exitCode === undefined ? t('failed') : t('failedExit', { code: String(run.exitCode) });
        case 'done':
            if (run.kind === 'caught-up') {
                return t('caughtUp', { time: formatClock(run.due, timeZone) });
            }
            if (run.waited === true) {
                return t('waitedDone', { duration: took() });
            }
            return run.kind === 'manual' ? t('doneManual', { duration: took() }) : t('done', { duration: took() });
    }
}
