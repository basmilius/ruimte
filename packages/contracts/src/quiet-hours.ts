import { z } from 'zod';
import { wallTimeOf, zonedTime } from './routine-schedule.ts';
import { ClockTimeSchema, WeekdaySchema } from './routine.ts';

/*
 * The hours of a device in which Ruimte raises no alert. A window belongs to the day it starts on; an `end` at
 * or before `start` runs into the next day, and the two equal make it a whole day. The time zone stays a plain
 * string, since a value this runtime does not know must not refuse a subscription: it reads as not quiet.
 */
export const QuietHoursSchema = z.object({
    days: z.array(WeekdaySchema).min(1).max(7),
    start: ClockTimeSchema,
    end: ClockTimeSchema,
    timeZone: z.string().min(1).max(64)
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export interface QuietState {
    quiet: boolean;

    /* When the state turns over, null when it never does; a time zone this runtime refuses is not quiet for good. */
    changesAt: number | null;
}

interface Window {
    from: number;
    to: number;
}

// A window lasts a day at most, so the one that holds `now` starts yesterday or today; the rest is how far ahead a start is looked for.
const DAYS_BACK = 1;
const DAYS_AHEAD = 14;

function minutesOf(time: string): number {
    const [hour, minute] = time.split(':').map(Number);

    return (hour ?? 0) * 60 + (minute ?? 0);
}

function windowsOf(hours: QuietHours, now: number): Window[] {
    const today = wallTimeOf(now, hours.timeZone);
    const startsAt = minutesOf(hours.start);
    const endsAt = minutesOf(hours.end);
    const windows: Window[] = [];

    for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset++) {
        const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
        const weekday = ((date.getUTCDay() + 6) % 7) + 1;

        if (!hours.days.includes(weekday)) {
            continue;
        }

        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        const from = zonedTime(year, month, day, Math.floor(startsAt / 60), startsAt % 60, hours.timeZone);
        let to = zonedTime(year, month, day, Math.floor(endsAt / 60), endsAt % 60, hours.timeZone);

        if (endsAt <= startsAt) {
            const next = new Date(Date.UTC(year, month - 1, day + 1));

            to = zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), Math.floor(endsAt / 60), endsAt % 60, hours.timeZone);
        }

        windows.push({ from, to });
    }

    return windows;
}

/* Joins windows that overlap or touch, so a quiet that carries on into the next day ends when it really does. */
function merged(windows: readonly Window[]): Window[] {
    const sorted = [...windows].sort((left, right) => left.from - right.from);
    const joined: Window[] = [];

    for (const window of sorted) {
        const last = joined.at(-1);

        if (last !== undefined && window.from <= last.to) {
            last.to = Math.max(last.to, window.to);
        } else {
            joined.push({ ...window });
        }
    }

    return joined;
}

/* Whether `now` falls in quiet hours and when that changes. */
export function quietState(hours: QuietHours, now: number): QuietState {
    let windows: Window[];

    try {
        windows = merged(windowsOf(hours, now));
    } catch {
        return { quiet: false, changesAt: null };
    }

    const current = windows.find((window) => window.from <= now && now < window.to);

    if (current !== undefined) {
        return { quiet: true, changesAt: current.to };
    }

    return { quiet: false, changesAt: windows.find((window) => window.from > now)?.from ?? null };
}
