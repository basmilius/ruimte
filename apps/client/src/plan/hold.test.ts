import { describe, expect, test } from 'bun:test';
import { Hold, type Schedule } from '@/plan/hold';

/* A clock that only moves when the test says so. */
const manualClock = () => {
    let now = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    let nextId = 0;
    const schedule: Schedule = (callback, ms) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, callback });
        return () => {
            timers.delete(id);
        };
    };
    const advance = (ms: number): void => {
        now += ms;
        for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
            if (timer.at <= now) {
                timers.delete(id);
                timer.callback();
            }
        }
    };
    return { schedule, advance, pending: () => timers.size };
};

const HOLD_MS = 1500;

const setup = () => {
    const clock = manualClock();
    const hold = new Hold<string>(HOLD_MS, (a, b) => a === b, clock.schedule);
    let changes = 0;
    hold.subscribe(() => changes++);
    return { clock, hold, changes: () => changes };
};

describe('a held value', () => {
    test('shows up at once', () => {
        const { hold, changes } = setup();
        hold.set('fix');
        expect(hold.get()).toBe('fix');
        expect(changes()).toBe(1);
    });

    test('keeps the last value for the hold after it went away, then lets go', () => {
        const { clock, hold, changes } = setup();
        hold.set('fix');
        hold.set(null);
        clock.advance(HOLD_MS - 1);
        expect(hold.get()).toBe('fix');
        clock.advance(1);
        expect(hold.get()).toBeNull();
        expect(changes()).toBe(2);
    });

    test('a new value during the hold replaces the old one without letting go in between', () => {
        const { clock, hold, changes } = setup();
        hold.set('fix');
        hold.set(null);
        clock.advance(800);
        hold.set('test');
        expect(hold.get()).toBe('test');
        clock.advance(HOLD_MS * 2);
        expect(hold.get()).toBe('test');
        expect(changes()).toBe(2);
        expect(clock.pending()).toBe(0);
    });

    test('repeated absence does not push the release further out', () => {
        const { clock, hold } = setup();
        hold.set('fix');
        hold.set(null);
        clock.advance(1000);
        hold.set(null);
        clock.advance(500);
        expect(hold.get()).toBeNull();
    });

    test('an equal value notifies nobody', () => {
        const { hold, changes } = setup();
        hold.set('fix');
        hold.set('fix');
        expect(changes()).toBe(1);
    });

    test('nothing to hold schedules nothing', () => {
        const { clock, hold } = setup();
        hold.set(null);
        expect(clock.pending()).toBe(0);
    });

    test('dispose drops a pending release', () => {
        const { clock, hold } = setup();
        hold.set('fix');
        hold.set(null);
        hold.dispose();
        clock.advance(HOLD_MS);
        expect(hold.get()).toBe('fix');
        expect(clock.pending()).toBe(0);
    });
});
