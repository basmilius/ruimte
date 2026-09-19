import { dateFormatter, wordFormatter } from '@/format/locale';

/* The parts that are a word rather than a number, and so come from the language and not the region. */
const WORD_PARTS = new Set<Intl.DateTimeFormatPartTypes>(['month', 'weekday', 'dayPeriod', 'era']);

/*
 * A date written the way the region writes one, with its words in the language the interface is in.
 * Both formatters get the same options and the same instant, so every part the region asks for has
 * one to lift the word from, whatever order the two put them in: `19 Sep` in English against a Dutch
 * region, `19 sep` once the interface is Dutch too, and a clock that reads `08:05` wherever the
 * region does not say AM.
 */
export const formatDateTime = (at: Date | number, options: Intl.DateTimeFormatOptions): string => {
    const date = typeof at === 'number' ? new Date(at) : at;
    const parts = dateFormatter(options).formatToParts(date);
    if (!parts.some((part) => WORD_PARTS.has(part.type))) {
        return parts.map((part) => part.value).join('');
    }
    const english = wordFormatter(options).formatToParts(date);
    return parts.map((part) => (WORD_PARTS.has(part.type) ? (english.find((word) => word.type === part.type)?.value ?? part.value) : part.value)).join('');
};

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const WEEKDAY_CLOCK: Intl.DateTimeFormatOptions = { weekday: 'short', hour: '2-digit', minute: '2-digit' };
const HOUR: Intl.DateTimeFormatOptions = { hour: 'numeric' };
const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const DAY_WITH_YEAR: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
const WEEKDAY_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
const DAY_CLOCK: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
const NUMERIC_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };

/* `08:05`, or `08:05 AM` in a region that counts to twelve. */
export const formatClock = (at: Date | number): string => formatDateTime(at, CLOCK);

/* `Sat 08:05`: a time far enough off that the day it lands on is part of the answer. */
export const formatWeekdayClock = (at: Date | number): string => formatDateTime(at, WEEKDAY_CLOCK);

/* An hour of the day on its own, for the foot of a chart: `08`, or `8 AM` where that is the clock. */
export const formatHour = (at: Date | number): string => formatDateTime(at, HOUR);

/* `19 Sep`, the short date a row falls back to once "days ago" stops meaning anything. */
export const formatDay = (at: Date | number): string => formatDateTime(at, DAY);

/* The same date with the year, for anything older than the one we are in. */
export const formatDayWithYear = (at: Date | number): string => formatDateTime(at, DAY_WITH_YEAR);

/* `Sat 19 Sep`, the label over a day in the usage chart. */
export const formatWeekdayDay = (at: Date | number): string => formatDateTime(at, WEEKDAY_DAY);

/* `19 Sep, 08:05`: a moment that is not today, to the minute. */
export const formatDayClock = (at: Date | number): string => formatDateTime(at, DAY_CLOCK);

/* All numbers, as a form would print it: `19-9-2026` here, `9/19/2026` in the United States. */
export const formatNumericDate = (at: Date | number): string => formatDateTime(at, NUMERIC_DATE);

/* Whether two instants fall on the same day of the same year, in the zone of whoever is reading. */
export const isSameDay = (a: Date | number, b: Date | number): boolean => {
    const left = typeof a === 'number' ? new Date(a) : a;
    const right = typeof b === 'number' ? new Date(b) : b;
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
};

/* The time when it happened today, the day and the time when it did not. */
export const formatMoment = (at: Date | number, now: Date | number = Date.now()): string => (isSameDay(at, now) ? formatClock(at) : formatDayClock(at));
