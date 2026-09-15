import { describe, expect, test } from 'bun:test';
import { SelfUpdater, buildFileOf, readBuildFile, selfUpdateVerdict, type SelfUpdateTimers, type SelfUpdaterOptions } from './self-update.ts';

describe('selfUpdateVerdict', () => {
    const facts = { underService: true, running: 'build-a', onDisk: 'build-b', idle: () => true };

    test('a different build on disk with nothing running is an update', () => {
        expect(selfUpdateVerdict(facts)).toBe('update');
    });

    test('the same build on disk is current', () => {
        expect(selfUpdateVerdict({ ...facts, onDisk: 'build-a' })).toBe('current');
    });

    test('a different build waits while work runs', () => {
        expect(selfUpdateVerdict({ ...facts, idle: () => false })).toBe('busy');
    });

    test('an id that cannot be read is no reason to exit', () => {
        expect(selfUpdateVerdict({ ...facts, onDisk: null })).toBe('unreadable');
    });

    test('a daemon outside the service never exits on its own', () => {
        expect(selfUpdateVerdict({ ...facts, underService: false })).toBe('off');
    });

    test('a build without an id (a checkout, the dev app) never exits on its own', () => {
        expect(selfUpdateVerdict({ ...facts, running: null })).toBe('off');
    });

    test('the process table is only read once the build differs', () => {
        let asked = 0;
        selfUpdateVerdict({
            ...facts,
            onDisk: 'build-a',
            idle: () => {
                asked += 1;
                return true;
            }
        });
        expect(asked).toBe(0);
    });
});

describe('the build file', () => {
    test('sits beside the binary', () => {
        expect(buildFileOf('/Applications/Ruimte.app/Contents/Resources/bin/ruimte')).toBe('/Applications/Ruimte.app/Contents/Resources/bin/ruimte.build');
    });

    test('is read trimmed, and a missing or empty one is null', () => {
        expect(readBuildFile('x', () => 'build-b\n')).toBe('build-b');
        expect(readBuildFile('x', () => '\n')).toBeNull();
        expect(
            readBuildFile('x', () => {
                throw new Error('ENOENT');
            })
        ).toBeNull();
    });
});

/* Timers that only run when the test says so. */
const manualTimers = () => {
    const intervals: Array<() => void> = [];
    const pending: Array<() => void> = [];
    const timers: SelfUpdateTimers = {
        every: (_ms, run) => {
            intervals.push(run);
            return () => intervals.splice(intervals.indexOf(run), 1);
        },
        after: (_ms, run) => {
            pending.push(run);
            return () => pending.splice(pending.indexOf(run), 1);
        }
    };
    return { timers, intervals, pending };
};

const updater = (overrides: Partial<SelfUpdaterOptions> = {}) => {
    const state = { onDisk: 'build-a', idle: false, exits: 0, logs: [] as string[] };
    const clock = manualTimers();
    const instance = new SelfUpdater({
        underService: true,
        running: 'build-a',
        readOnDisk: () => state.onDisk,
        idle: () => state.idle,
        exit: () => {
            state.exits += 1;
        },
        log: (line) => state.logs.push(line),
        timers: clock.timers,
        ...overrides
    });
    return { instance, state, clock };
};

describe('SelfUpdater', () => {
    test('exits once when a newer build is on disk and the machine is idle', () => {
        const { instance, state, clock } = updater();
        instance.start();
        clock.intervals[0]!();
        expect(state.exits).toBe(0);
        state.onDisk = 'build-b';
        state.idle = true;
        clock.intervals[0]?.();
        expect(state.exits).toBe(1);
        expect(clock.intervals).toHaveLength(0);
        instance.check();
        expect(state.exits).toBe(1);
    });

    test('waits while busy, logs that once, and goes when a nudge finds it idle', () => {
        const { instance, state, clock } = updater();
        instance.start();
        state.onDisk = 'build-b';
        clock.intervals[0]!();
        clock.intervals[0]!();
        expect(state.exits).toBe(0);
        expect(state.logs).toHaveLength(1);
        state.idle = true;
        instance.nudge();
        instance.nudge();
        expect(clock.pending).toHaveLength(1);
        clock.pending[0]!();
        expect(state.exits).toBe(1);
        expect(state.logs).toHaveLength(2);
    });

    test('does not start outside the service', () => {
        const { instance, clock } = updater({ underService: false });
        instance.start();
        instance.nudge();
        expect(clock.intervals).toHaveLength(0);
        expect(clock.pending).toHaveLength(0);
    });

    test('does not exit outside the service even when asked directly', () => {
        const { instance, state } = updater({ underService: false });
        state.onDisk = 'build-b';
        state.idle = true;
        expect(instance.check()).toBe('off');
        expect(state.exits).toBe(0);
    });
});
