import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
    formatClock,
    formatDay,
    formatDayClock,
    formatDayWithYear,
    formatHour,
    formatMoment,
    formatNumericDate,
    formatWeekdayDay,
    isSameDay
} from './datetime.ts';
import { FORMAT_LANGUAGE } from './regions.ts';
import { fakeFormatSource } from './fake-source.ts';
import { setFormatSource, type FormatSource } from './locale.ts';

const source = fakeFormatSource();
let previous: FormatSource;

beforeAll(() => {
    previous = setFormatSource(source);
});

afterAll(() => {
    setFormatSource(previous);
});

const AT = new Date(2026, 8, 19, 8, 5);

const inRegion = (region: string): void => {
    source.set({ region });
};

const inLanguage = (language: string): void => {
    source.set({ language });
};

afterEach(() => {
    source.set({ region: FORMAT_LANGUAGE, language: 'en' });
});

describe('a clock', () => {
    test('counts to twenty four where the region does', () => {
        inRegion('nl-NL');
        expect(formatClock(AT)).toBe('08:05');
    });

    test('says AM where the region does', () => {
        inRegion('en-US');
        expect(formatClock(AT)).toBe('08:05 AM');
    });

    test('is a bare hour on the foot of a chart', () => {
        inRegion('nl-NL');
        expect(formatHour(AT)).toBe('08');
        inRegion('en-US');
        expect(formatHour(AT)).toBe('8 AM');
    });
});

describe('a date', () => {
    test('is ordered by the region and worded in English', () => {
        inRegion('nl-NL');
        expect(formatDay(AT)).toBe('19 Sep');
        expect(formatDayWithYear(AT)).toBe('19 Sep 2026');
        expect(formatWeekdayDay(AT)).toBe('Sat 19 Sep');
        expect(formatDayClock(AT)).toBe('19 Sep, 08:05');
    });

    test('keeps the American order where that is the region', () => {
        inRegion('en-US');
        expect(formatDay(AT)).toBe('Sep 19');
        expect(formatWeekdayDay(AT)).toBe('Sat, Sep 19');
    });

    test('has no word left in it when every part is a number', () => {
        inRegion('nl-NL');
        expect(formatNumericDate(AT)).toBe('19-9-2026');
        inRegion('en-US');
        expect(formatNumericDate(AT)).toBe('9/19/2026');
    });
});

describe('the language a date is written in', () => {
    // The words follow the interface, the notation follows the region, and a person sets them apart:
    // an English app on a Dutch Mac is exactly that pair.
    test('writes its month in the language, in the order of the region', () => {
        inLanguage('nl');
        inRegion('nl-NL');
        expect(formatDay(AT)).toBe('19 sep');
        expect(formatWeekdayDay(AT)).toBe('za 19 sep');
    });

    test('keeps English words against the same Dutch notation', () => {
        inLanguage('en');
        inRegion('nl-NL');
        expect(formatDay(AT)).toBe('19 Sep');
        expect(formatClock(AT)).toBe('08:05');
    });

    // Following the language is what a fresh client does, so Dutch alone is enough for Dutch dates.
    test('takes the region of the language when the region follows it', () => {
        inLanguage('nl');
        inRegion(FORMAT_LANGUAGE);
        expect(formatDay(AT)).toBe('19 sep');
        expect(formatClock(AT)).toBe('08:05');
    });
});

describe('a moment', () => {
    test('is the time alone when it happened today', () => {
        inRegion('nl-NL');
        const now = new Date(2026, 8, 19, 22, 0);
        expect(formatMoment(AT, now)).toBe('08:05');
    });

    test('carries its day once it did not', () => {
        inRegion('nl-NL');
        const now = new Date(2026, 8, 20, 9, 0);
        expect(formatMoment(AT, now)).toBe('19 Sep, 08:05');
    });

    test('counts a day by the calendar and not by the hours in between', () => {
        expect(isSameDay(new Date(2026, 8, 19, 23, 59), new Date(2026, 8, 19, 0, 1))).toBe(true);
        expect(isSameDay(new Date(2026, 8, 19, 23, 59), new Date(2026, 8, 20, 0, 1))).toBe(false);
    });
});
