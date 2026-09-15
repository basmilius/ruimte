import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { readdir, stat } from 'node:fs/promises';
import { RESTORED_TEXT } from './session.ts';
import { scheduleSnapshots } from './snapshot-store.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    jest.useRealTimers();
    await harness.cleanup();
});

describe('SnapshotStore', () => {
    test('writes into a private directory and reads back exactly what was written', async () => {
        await harness.snapshots.write('a', 'one');
        await harness.snapshots.write('a', 'two');
        expect(await harness.snapshots.read('a')).toBe('two');
        expect(await harness.snapshots.read('missing')).toBeNull();

        const mode = (await stat(harness.snapshots.dir)).mode & 0o777;
        expect(mode).toBe(0o700);
        // No temp file may survive a completed write.
        expect(await readdir(harness.snapshots.dir)).toEqual(['a.txt']);

        await harness.snapshots.delete('a');
        expect(await harness.snapshots.read('a')).toBeNull();
    });

    test('keeps a hostile id inside the sessions directory', async () => {
        await harness.snapshots.write('../escape/../x', 'text');
        expect(await readdir(harness.snapshots.dir)).toEqual([`${encodeURIComponent('../escape/../x')}.txt`]);
        expect(await harness.snapshots.read('../escape/../x')).toBe('text');
    });
});

describe('snapshot and restore', () => {
    test('a snapshot of a live session restores into a new session with the marker', async () => {
        await harness.manager.create({ sessionId: 'r1', cols: 80, rows: 24, cwd: harness.home });
        harness.adapter.forSession('r1').emit('survives\r\n');

        const schedule = scheduleSnapshots(harness.manager, harness.snapshots, 60_000);
        await schedule.flush();
        schedule.stop();
        expect(await harness.snapshots.read('r1')).toContain('survives');

        // A daemon restart: the old manager is gone, a new one over the same home finds only the file.
        harness.manager.killAll();
        await harness.adapter.forSession('r1').exited;
        const restarted = await makeHarness({}, harness.home);
        try {
            const recorder = new Recorder();
            restarted.manager.subscribe('c2', recorder.sink());
            await restarted.manager.create({ sessionId: 'r1', cols: 80, rows: 24, cwd: harness.home });
            const attached = await restarted.manager.attach('r1', 'c2', 80, 24);
            expect(attached.screen).toContain('survives');
            expect(attached.screen).toContain(RESTORED_TEXT);
            expect(attached.screen.indexOf('survives')).toBeLessThan(attached.screen.indexOf(RESTORED_TEXT));

            // The fresh shell writes below the marker.
            restarted.adapter.forSession('r1').emit('after\r\n');
            const screen = await restarted.manager.get('r1')!.serializeScreen();
            expect(screen.indexOf(RESTORED_TEXT)).toBeLessThan(screen.indexOf('after'));
        } finally {
            await restarted.cleanup();
        }
    });

    test('the schedule writes on its timer', async () => {
        jest.useFakeTimers();
        let passes = 0;
        const source = {
            snapshotAll: () => {
                passes += 1;
                return Promise.resolve([{ sessionId: 't1', screen: `pass ${passes}` }]);
            }
        };
        const schedule = scheduleSnapshots(source, harness.snapshots, 20);
        try {
            jest.advanceTimersByTime(19);
            expect(passes).toBe(0);
            jest.advanceTimersByTime(1);
            expect(passes).toBe(1);
            // The pass the timer started is in flight, so this awaits that one instead of starting another.
            await schedule.flush();
            expect(passes).toBe(1);
            expect(await harness.snapshots.read('t1')).toBe('pass 1');
        } finally {
            schedule.stop();
        }
    });
});
