import { describe, expect, test } from 'bun:test';
import type { AgendaBlock } from './agenda';
import { clockWords, cronProblemWords, everyWords, foldWords, scheduleWords } from './words';

// The test region writes its own clock, so a time is read back through the same words.
const at = (time: string): string => clockWords(time);

describe('a repeat within a day in words', () => {
    test('names its days, its step and its first and last time', () => {
        expect(scheduleWords({ kind: 'interval', days: [1, 2, 3, 4, 5], every: 60, from: '09:00', to: '17:00' })).toBe(
            `Weekdays, every hour from ${at('09:00')} to ${at('17:00')}`
        );
        expect(scheduleWords({ kind: 'interval', days: [7, 6], every: 30, from: '08:00', to: '18:00' })).toBe(
            `Weekends, every 30 minutes from ${at('08:00')} to ${at('18:00')}`
        );
        expect(scheduleWords({ kind: 'interval', days: [1, 2, 3, 4, 5, 6, 7], every: 120, from: '10:00', to: '16:00' })).toBe(
            `Daily, every 2 hours from ${at('10:00')} to ${at('16:00')}`
        );
        expect(scheduleWords({ kind: 'interval', days: [3, 1], every: 15, from: '10:00', to: '11:00' })).toBe(
            `Mon, Wed, every 15 minutes from ${at('10:00')} to ${at('11:00')}`
        );
        expect(scheduleWords({ kind: 'interval', days: [2], every: 240, from: '06:00', to: '22:00' })).toBe(
            `Tuesday, every 4 hours from ${at('06:00')} to ${at('22:00')}`
        );
    });

    test('writes a step in minutes or hours', () => {
        expect([15, 45, 60, 180].map(everyWords)).toEqual(['every 15 minutes', 'every 45 minutes', 'every hour', 'every 3 hours']);
    });
});

describe('a folded chip in words', () => {
    const block = (look: AgendaBlock['look']): AgendaBlock => ({ key: look, day: 0, at: 0, look, run: null });

    test('counts its runs and the ones that failed', () => {
        expect(foldWords({ kind: 'runs', key: 'r', at: 0, blocks: [block('done'), block('done'), block('done')], failed: 0 }, 'UTC')).toBe('3 runs');
        expect(foldWords({ kind: 'runs', key: 'r', at: 0, blocks: [block('done'), block('failed'), block('done')], failed: 1 }, 'UTC')).toBe(
            '3 runs · 1 failed'
        );
    });

    test('says how often the rest of the day runs and until when', () => {
        expect(foldWords({ kind: 'coming', key: 'c', at: 0, blocks: [block('next'), block('next')], every: 60, to: '17:00' }, 'UTC')).toBe(
            `every hour until ${at('17:00')}`
        );
    });

    test('counts the rest of the day of a cron and says until when', () => {
        const last = { ...block('next'), at: Date.UTC(2026, 9, 26, 17, 0) };
        expect(foldWords({ kind: 'coming', key: 'c', at: 0, blocks: [block('next'), block('next'), last], every: null }, 'UTC')).toBe(
            `3 more until ${at('17:00')}`
        );
    });
});

describe('a cron in words', () => {
    test('shows its expression', () => {
        expect(scheduleWords({ kind: 'cron', expression: '0 9 * * 1-5' })).toBe('Cron 0 9 * * 1-5');
    });

    test('says why the form does not take an expression', () => {
        expect(cronProblemWords({ kind: 'shape' })).toBe('Give five fields: minute, hour, day of month, month and day of week.');
        expect(cronProblemWords({ kind: 'field', field: 'hour', part: '25' })).toBe('The hour (0-23) field does not take "25".');
        expect(cronProblemWords({ kind: 'often' })).toStartWith('This runs more often than every 15 minutes.');
    });
});
