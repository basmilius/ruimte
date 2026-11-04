import { cronClocks, cronMatchesDay, parseCron } from './routine-cron.ts';
import type { RoutineSchedule } from './routine.ts';

/* Shared by the daemon, which owes a routine its times, and a client, which draws them in a week. */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface WallTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    // ISO: 1 is Monday.
    weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
    let formatter = formatters.get(timeZone);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            weekday: 'short'
        });
        formatters.set(timeZone, formatter);
    }
    return formatter;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/* The wall clock of `at` in a time zone. */
export function wallTimeOf(at: number, timeZone: string): WallTime {
    const parts = Object.fromEntries(
        formatterOf(timeZone)
            .formatToParts(at)
            .map((part) => [part.type, part.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        weekday: WEEKDAYS[parts.weekday ?? 'Mon'] ?? 1
    };
}

function offsetAt(at: number, timeZone: string): number {
    const wall = wallTimeOf(at, timeZone);
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - Math.floor(at / MINUTE_MS) * MINUTE_MS;
}

/*
 * The moment a wall time happens in a time zone. A time the clock skips as it goes forward happens
 * as late as the skip, the way a person's alarm would; a time that happens twice as the clock goes
 * back is its first time, so a routine runs that night once.
 */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
    const asUtc = Date.UTC(year, month - 1, day, hour, minute);
    const candidates = new Set<number>();
    for (const probe of [asUtc - DAY_MS, asUtc, asUtc + DAY_MS]) {
        candidates.add(asUtc - offsetAt(probe, timeZone));
    }
    const exact = [...candidates].filter((at) => {
        const wall = wallTimeOf(at, timeZone);
        return wall.year === year && wall.month === month && wall.day === day && wall.hour === hour && wall.minute === minute;
    });
    if (exact.length > 0) {
        return Math.min(...exact);
    }
    // In a gap: the wall time read with the offset from before the jump, which lands after it.
    return asUtc - offsetAt(asUtc - DAY_MS, timeZone);
}

function clockOf(time: string): { hour: number; minute: number } {
    const [hour, minute] = time.split(':').map(Number);
    return { hour: hour ?? 0, minute: minute ?? 0 };
}

function minutesOf(time: string): number {
    const { hour, minute } = clockOf(time);
    return hour * 60 + minute;
}

type RepeatSchedule = Exclude<RoutineSchedule, { kind: 'once' }>;

/* The wall times of an interval on one day, as minutes past midnight, `to` included. */
function intervalClocks(schedule: Extract<RoutineSchedule, { kind: 'interval' }>): number[] {
    const from = clockOf(schedule.from);
    const to = clockOf(schedule.to);
    const clocks: number[] = [];
    for (let minutes = from.hour * 60 + from.minute; minutes <= to.hour * 60 + to.minute; minutes += Math.max(schedule.every, 1)) {
        clocks.push(minutes);
    }
    return clocks;
}

interface Repeat {
    // The wall clocks of a calendar day, as minutes past midnight; none on a day it skips.
    clocksOn(year: number, month: number, day: number): readonly number[];
    // How many days ahead a next time may lie.
    horizon: number;
}

// Eight days covers every weekday once past today, whatever today's time.
const WEEK_HORIZON = 8;

// A date falls on each weekday within 28 years, 29 February too, so a cron that runs at all runs within them.
const CRON_HORIZON = 28 * 366;

function repeatOf(schedule: RepeatSchedule): Repeat | null {
    if (schedule.kind === 'cron') {
        const parsed = parseCron(schedule.expression);
        if (!parsed.ok) {
            return null;
        }
        const clocks = cronClocks(parsed.cron);
        return { horizon: CRON_HORIZON, clocksOn: (year, month, day) => (cronMatchesDay(parsed.cron, year, month, day) ? clocks : []) };
    }
    const clocks = schedule.kind === 'weekly' ? [minutesOf(schedule.time)] : intervalClocks(schedule);
    return {
        horizon: WEEK_HORIZON,
        clocksOn: (year, month, day) => {
            const weekday = ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
            return schedule.days.includes(weekday) ? clocks : [];
        }
    };
}

/*
 * The moments a repeating schedule is due on one calendar day, oldest first and each once. Times in a
 * skip land after it and may meet a time that follows, and a doubled time is its first, so the set holds.
 */
function dayTimes(repeat: Repeat, year: number, month: number, day: number, timeZone: string): number[] {
    const clocks = repeat.clocksOn(year, month, day);
    if (clocks.length === 0) {
        return [];
    }
    const times = new Set(clocks.map((minutes) => zonedTime(year, month, day, Math.floor(minutes / 60), minutes % 60, timeZone)));
    return [...times].sort((left, right) => left - right);
}

function dayAfter(start: WallTime, offset: number): { year: number; month: number; day: number } {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function onceTime(schedule: Extract<RoutineSchedule, { kind: 'once' }>, timeZone: string): number {
    const { hour, minute } = clockOf(schedule.time);
    const [year, month, day] = schedule.date.split('-').map(Number);
    return zonedTime(year!, month!, day!, hour, minute, timeZone);
}

/* The first time the schedule is due strictly after `after`; null for a once that is past. */
export function nextDue(schedule: RoutineSchedule, after: number, timeZone: string): number | null {
    if (schedule.kind === 'once') {
        const at = onceTime(schedule, timeZone);
        return at > after ? at : null;
    }
    const repeat = repeatOf(schedule);
    if (repeat === null) {
        return null;
    }
    const start = wallTimeOf(after, timeZone);
    for (let offset = 0; offset <= repeat.horizon; offset++) {
        const { year, month, day } = dayAfter(start, offset);
        const next = dayTimes(repeat, year, month, day, timeZone).find((at) => at > after);
        if (next !== undefined) {
            return next;
        }
    }
    return null;
}

/* Every due time in `(from, to]`, oldest first, at most `limit`. */
export function dueTimesBetween(schedule: RoutineSchedule, from: number, to: number, timeZone: string, limit = 50): number[] {
    if (schedule.kind === 'once') {
        const at = onceTime(schedule, timeZone);
        return at > from && at <= to && limit > 0 ? [at] : [];
    }
    const repeat = repeatOf(schedule);
    if (repeat === null) {
        return [];
    }
    const times: number[] = [];
    const start = wallTimeOf(from, timeZone);
    for (let offset = 0; times.length < limit; offset++) {
        const { year, month, day } = dayAfter(start, offset);
        // No time of a day comes before its midnight, so a day that starts past `to` ends the walk.
        if (offset > 0 && zonedTime(year, month, day, 0, 0, timeZone) > to) {
            break;
        }
        for (const at of dayTimes(repeat, year, month, day, timeZone)) {
            if (at > from && at <= to && times.length < limit) {
                times.push(at);
            }
        }
    }
    return times;
}
