import { afterEach, describe, expect, test } from 'bun:test';
import { formatAgo, formatCountdown, formatDuration } from '@/format/duration';
import { FORMAT_SYSTEM } from '@/format/regions';
import { useSettings } from '@/state/settings';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const inRegion = (region: string): void => {
    useSettings.getState().update({ formatRegion: region });
};

afterEach(() => {
    inRegion(FORMAT_SYSTEM);
});

describe('how long something took', () => {
    test('climbs to the coarsest unit that still says something', () => {
        inRegion('en-US');
        expect(formatDuration(30_000)).toBe('30 s');
        expect(formatDuration(5 * MINUTE)).toBe('5 min');
        expect(formatDuration(90 * MINUTE)).toBe('1.5 h');
    });

    test('writes its decimal the way the region does', () => {
        inRegion('nl-NL');
        expect(formatDuration(90 * MINUTE)).toBe('1,5 h');
    });
});

describe('how long a window still has', () => {
    test('is two units wide until it comes down to minutes', () => {
        inRegion('nl-NL');
        expect(formatCountdown(4 * DAY + 3 * HOUR)).toBe('4d 3h');
        expect(formatCountdown(12 * HOUR + 8 * MINUTE)).toBe('12h 8m');
        expect(formatCountdown(9 * MINUTE)).toBe('9m');
    });

    // Under a minute the window is all but gone, and `0m` reads as spent rather than as nearly so.
    test('never counts down to zero minutes', () => {
        expect(formatCountdown(10_000)).toBe('1m');
        expect(formatCountdown(0)).toBe('1m');
    });
});

describe('how long ago something was', () => {
    test('says so in words under a minute and in units above it', () => {
        expect(formatAgo(30_000)).toBe('just now');
        expect(formatAgo(3 * MINUTE)).toBe('3m ago');
        expect(formatAgo(5 * HOUR)).toBe('5h ago');
        expect(formatAgo(9 * DAY)).toBe('9d ago');
    });

    test('reads a clock that runs ahead as now rather than as the future', () => {
        expect(formatAgo(-5000)).toBe('just now');
    });
});
