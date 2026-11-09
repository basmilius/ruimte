import { describe, expect, test } from 'bun:test';
import { QuietHoursSchema, quietState, type QuietHours } from './quiet-hours.ts';
import { zonedTime } from './routine-schedule.ts';

const AMS = 'Europe/Amsterdam';
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const night: QuietHours = { days: EVERY_DAY, start: '22:00', end: '07:00', timeZone: AMS };

function at(year: number, month: number, day: number, hour: number, minute: number, timeZone = AMS): number {
    return zonedTime(year, month, day, hour, minute, timeZone);
}

describe('quietState', () => {
    test('a window across midnight is quiet on both sides of it and ends the next morning', () => {
        const evening = quietState(night, at(2026, 11, 3, 23, 30));
        const early = quietState(night, at(2026, 11, 4, 3, 0));

        expect(evening).toEqual({ quiet: true, changesAt: at(2026, 11, 4, 7, 0) });
        expect(early).toEqual({ quiet: true, changesAt: at(2026, 11, 4, 7, 0) });
    });

    test('outside the window it names the next start', () => {
        expect(quietState(night, at(2026, 11, 4, 12, 0))).toEqual({ quiet: false, changesAt: at(2026, 11, 4, 22, 0) });
    });

    test('the start is quiet and the end is not', () => {
        expect(quietState(night, at(2026, 11, 3, 22, 0)).quiet).toBe(true);
        expect(quietState(night, at(2026, 11, 4, 7, 0)).quiet).toBe(false);
    });

    test('a window within one day does not touch the night around it', () => {
        const lunch: QuietHours = { days: EVERY_DAY, start: '12:00', end: '13:00', timeZone: AMS };

        expect(quietState(lunch, at(2026, 11, 4, 12, 30))).toEqual({ quiet: true, changesAt: at(2026, 11, 4, 13, 0) });
        expect(quietState(lunch, at(2026, 11, 4, 2, 0))).toEqual({ quiet: false, changesAt: at(2026, 11, 4, 12, 0) });
    });

    test('a window belongs to the day it starts on', () => {
        // Friday 6 November 2026 only: Friday night runs into Saturday morning, Saturday night does not start.
        const friday: QuietHours = { ...night, days: [5] };

        expect(quietState(friday, at(2026, 11, 7, 3, 0)).quiet).toBe(true);
        expect(quietState(friday, at(2026, 11, 6, 3, 0)).quiet).toBe(false);
        expect(quietState(friday, at(2026, 11, 7, 23, 0))).toEqual({ quiet: false, changesAt: at(2026, 11, 13, 22, 0) });
    });

    test('a day that is not listed is never quiet', () => {
        const weekdays: QuietHours = { ...night, days: [1, 2, 3, 4, 5] };

        // Saturday 7 November 2026, noon and the evening after.
        expect(quietState(weekdays, at(2026, 11, 7, 23, 0))).toEqual({ quiet: false, changesAt: at(2026, 11, 9, 22, 0) });
    });

    test('start equal to end is a whole day, and listed days run together', () => {
        const weekend: QuietHours = { days: [6, 7], start: '00:00', end: '00:00', timeZone: AMS };

        expect(quietState(weekend, at(2026, 11, 7, 15, 0))).toEqual({ quiet: true, changesAt: at(2026, 11, 9, 0, 0) });
        expect(quietState(weekend, at(2026, 11, 9, 0, 0))).toEqual({ quiet: false, changesAt: at(2026, 11, 14, 0, 0) });
    });

    test('a quiet that continues into the next listed night ends only after the last', () => {
        // 22:00 to 22:00 is a whole day from the evening on, so back to back days make one stretch.
        const stretch: QuietHours = { days: [5, 6], start: '22:00', end: '22:00', timeZone: AMS };

        expect(quietState(stretch, at(2026, 11, 6, 23, 0))).toEqual({ quiet: true, changesAt: at(2026, 11, 8, 22, 0) });
    });

    test('the night the clock goes back lasts an hour longer', () => {
        // Sunday 25 October 2026, 03:00 CEST goes back to 02:00 CET.
        const state = quietState(night, at(2026, 10, 24, 23, 0));

        expect(state.quiet).toBe(true);
        expect(state.changesAt).toBe(at(2026, 10, 25, 7, 0));
        expect(state.changesAt! - at(2026, 10, 24, 22, 0)).toBe(9 * 3_600_000 + 3_600_000);
    });

    test('the night the clock goes forward lasts an hour shorter', () => {
        // Sunday 29 March 2026, 02:00 CET goes forward to 03:00 CEST.
        const start = at(2026, 3, 28, 22, 0);
        const state = quietState(night, start);

        expect(state.changesAt! - start).toBe(9 * 3_600_000 - 3_600_000);
    });

    test('a time zone this runtime refuses reads as not quiet', () => {
        expect(quietState({ ...night, timeZone: 'Not/AZone' }, at(2026, 11, 3, 23, 30))).toEqual({ quiet: false, changesAt: null });
    });

    test('the same instant is a different hour in another time zone', () => {
        const instant = at(2026, 11, 4, 3, 0, AMS);

        expect(quietState(night, instant).quiet).toBe(true);
        expect(quietState({ ...night, timeZone: 'Asia/Tokyo' }, instant).quiet).toBe(false);
    });
});

describe('QuietHoursSchema', () => {
    test('takes an unknown time zone, since only a runtime can tell', () => {
        expect(QuietHoursSchema.safeParse({ ...night, timeZone: 'Not/AZone' }).success).toBe(true);
    });

    test('refuses a time that is not a 24-hour clock time and a weekday out of range', () => {
        expect(QuietHoursSchema.safeParse({ ...night, start: '24:00' }).success).toBe(false);
        expect(QuietHoursSchema.safeParse({ ...night, days: [0] }).success).toBe(false);
        expect(QuietHoursSchema.safeParse({ ...night, days: [] }).success).toBe(false);
    });
});
