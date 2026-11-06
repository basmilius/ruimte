import { resolve } from 'node:path';
import { writeGenerated } from '../../../apps/ios/Scripts/generated.ts';
import { adecore, adecoreEntry, compactFixture } from './adecore-port.ts';

/*
 * The cases the phone's `Format` is held to, with what `@adecore/ui/format` writes for them. The desktop reads clock
 * and calendar in the zone of the machine, so the zone is fixed before the formatter builds its first date.
 */
process.env.TZ = 'Europe/Amsterdam';

const destination = resolve(import.meta.dir, '../../../apps/ios/Packages/RuimtePulsar/Tests/RuimtePulsarTests/Fixtures/ports-format.json');

interface FormatModule {
    formatAgo(ms: number): string;
    formatBytes(bytes: number, whole?: boolean): string;
    formatClock(at: number): string;
    formatClockDuration(ms: number): string;
    formatCountdown(ms: number): string;
    formatDay(at: number): string;
    formatDayClock(at: number): string;
    formatDayClockWithYear(at: number): string;
    formatDayWithYear(at: number): string;
    formatDecimal(value: number): string;
    formatDuration(ms: number): string;
    formatElapsedShort(ms: number): string;
    formatHour(at: number): string;
    formatMoment(at: number, now: number): string;
    formatMoney(value: number, currency: string, maximumFractionDigits?: number): string;
    formatNumber(value: number): string;
    formatNumericDate(at: number): string;
    formatPercent(value: number): string;
    formatRounded(value: number, decimals: number): string;
    formatTokens(value: number): string;
    formatUsdSignificant(value: number): string;
    formatWeekdayClock(at: number): string;
    formatWeekdayDay(at: number): string;
    isSameDay(a: number, b: number): boolean;
    setFormatSource(source: { language(): string; region(): string; subscribe(): () => void }): unknown;
}

const format = await adecore<FormatModule>('@adecore/ui/format');
// `formatFixed` is used inside ADE CORE only and is not in its public API, but it is the same module instance.
const { formatFixed } = await adecore<{ formatFixed(value: number, decimals: number): string }>(`${adecoreEntry('@adecore/ui/format')}/number.js`);

/* The app's own mixes: an English app on a Dutch iPhone is region nl-NL with English words. */
const settings: { region: string; language: string }[] = [
    { region: 'nl-NL', language: 'en' },
    { region: 'nl-NL', language: 'nl' },
    { region: 'en-US', language: 'en' },
    { region: 'en-GB', language: 'en' },
    { region: 'en-US', language: 'nl' },
    { region: 'de-DE', language: 'en' },
    { region: 'fr-FR', language: 'en' }
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const numbers = [0, 0.4, 0.5, 1.5, 2.5, -0.4, -0.5, -1.5, -2.5, 999.5, 1234.567, 1e6, 12345678.9, 1e15];
const decimals = [0, 0.04, 0.05, 0.15, 0.25, 1.25, 1.35, 1.45, 1.5, 9.95, 10.05, 1234.56, -0.04, -1.25, 100, 1e7 + 0.05];
const percents = [0, 0.04, 9.94, 9.95, 10, 10.5, 42.4, 99.5, 100, 100.4];
const tokens = [
    0, 640, 999, 999.5, 1000, 1499, 1500, 9999, 9999.5, 10_000, 12_345, 412_000, 999_499, 999_500, 1_000_000, 1_240_000, 9_999_999, 10_000_000, 11_900_000,
    123_456_789
];
const sizes = [-5, 0, 1, 512, 1023, 1024, 1536, 10_239, 10_240, 500_000, 1_048_575, 1_048_576, 1.5 * 1_048_576, 1e9, 1e12, 5e15];
const durations = [
    -1,
    0,
    499,
    500,
    1000,
    12_400,
    29_500,
    59_499,
    59_500,
    60_000,
    89_999,
    90_000,
    125_000,
    3_599_000,
    3_600_000,
    3_780_000,
    5_400_000,
    DAY,
    1e9
];
const countdowns = [
    -1,
    0,
    10_000,
    29_999,
    30_000,
    9 * MINUTE,
    HOUR - 1,
    HOUR,
    12 * HOUR + 8 * MINUTE,
    DAY - 1,
    DAY,
    4 * DAY + 3 * HOUR,
    4 * DAY + 11.5 * HOUR,
    30 * DAY
];
const clocks = [-1000, 0, 400, 999, 1000, 14_900, 59_999, 3_599_999, HOUR + 2 * MINUTE + 3000, 100 * HOUR];
const agos = [-5000, 0, 30_000, 59_999, MINUTE, 3 * MINUTE, HOUR - 1, HOUR, 5 * HOUR, DAY - 1, DAY, 9 * DAY, 400 * DAY];

const instants = [
    '2026-09-19T06:05:09Z',
    '2026-09-19T22:00:00Z',
    '2026-09-19T10:05:00Z',
    '2026-09-19T11:05:00Z',
    '2026-09-19T21:59:59Z',
    '2026-01-01T00:00:00Z',
    '2025-12-31T23:30:00Z',
    '2026-03-29T00:59:59Z',
    '2026-03-29T01:00:00Z',
    '2026-10-24T23:59:59Z',
    '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z',
    '2026-02-28T12:00:00Z',
    '2024-02-29T08:00:00Z',
    '2027-06-07T15:45:00Z'
].map((text) => Date.parse(text));

interface Case {
    fn: string;
    args: unknown[];
    region: string;
    language: string;
    result: string | boolean;
}

const cases: Case[] = [];
let current = settings[0]!;

format.setFormatSource({ language: () => current.language, region: () => current.region, subscribe: () => () => {} });

function record(fn: string, args: unknown[], result: string | boolean): void {
    cases.push({ fn, args, region: current.region, language: current.language, result });
}

for (current of settings) {
    for (const value of numbers) {
        record('number', [value], format.formatNumber(value));
    }

    for (const value of decimals) {
        record('decimal', [value], format.formatDecimal(value));

        for (const places of [0, 1, 2, 3]) {
            record('fixed', [value, places], formatFixed(value, places));
            record('rounded', [value, places], format.formatRounded(value, places));
        }
    }

    for (const value of percents) {
        record('percent', [value], format.formatPercent(value));
    }

    for (const currency of ['USD', 'EUR', 'GBP', 'JPY']) {
        for (const value of [0, 0.0032, 1.005, 5480.96, -12.5, 1_000_000]) {
            record('money', [value, currency], format.formatMoney(value, currency));

            for (const digits of [2, 4]) {
                record('money', [value, currency, digits], format.formatMoney(value, currency, digits));
            }
        }
    }

    for (const value of [0, 0.004, 0.0683, 0.55, 1, 7.634, 10, 99.999, 1234.5]) {
        record('usdSignificant', [value], format.formatUsdSignificant(value));
    }

    for (const value of tokens) {
        record('tokens', [value], format.formatTokens(value));
    }

    for (const value of sizes) {
        record('bytes', [value, false], format.formatBytes(value));
        record('bytes', [value, true], format.formatBytes(value, true));
    }

    for (const value of durations) {
        record('duration', [value], format.formatDuration(value));
        record('elapsedShort', [value], format.formatElapsedShort(value));
    }

    for (const value of countdowns) {
        record('countdown', [value], format.formatCountdown(value));
    }

    for (const value of clocks) {
        record('clockDuration', [value], format.formatClockDuration(value));
    }

    for (const value of agos) {
        record('ago', [value], format.formatAgo(value));
    }

    for (const at of instants) {
        record('clock', [at], format.formatClock(at));
        record('weekdayClock', [at], format.formatWeekdayClock(at));
        record('hour', [at], format.formatHour(at));
        record('day', [at], format.formatDay(at));
        record('dayWithYear', [at], format.formatDayWithYear(at));
        record('weekdayDay', [at], format.formatWeekdayDay(at));
        record('dayClock', [at], format.formatDayClock(at));
        record('dayClockWithYear', [at], format.formatDayClockWithYear(at));
        record('numericDate', [at], format.formatNumericDate(at));
    }

    for (const [index, at] of instants.entries()) {
        for (const now of [instants[0]!, instants[(index + 1) % instants.length]!, at + HOUR]) {
            record('moment', [at, now], format.formatMoment(at, now));
            record('isSameDay', [at, now], format.isSameDay(at, now));
        }
    }
}

await writeGenerated(new Map([[destination, compactFixture({ cases })]]), `${cases.length} format cases`);
