import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, stat } from 'node:fs/promises';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { SessionManager } from './manager.ts';
import { RESTORED_TEXT } from './session.ts';
import { scheduleSnapshots } from './snapshot-store.ts';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, waitForAsync, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
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
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.manager.create({ sessionId: 'r1', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
        await harness.manager.attach('r1', 'c1', 80, 24);
        harness.manager.write('r1', 'echo sur""vives\n');
        await waitFor(() => recorder.output.includes('survives'), 'survives');

        const schedule = scheduleSnapshots(harness.manager, harness.snapshots, 60_000);
        await schedule.flush();
        schedule.stop();
        expect(await harness.snapshots.read('r1')).toContain('survives');

        // A daemon restart: the old manager is gone, a new one finds only the file.
        harness.manager.killAll();
        await waitFor(() => harness.manager.list().every((session) => session.exited), 'old shell gone');
        const restored = await makeHarness();
        try {
            const manager = new SessionManager({
                adapter: new BunPtyAdapter(),
                snapshots: harness.snapshots,
                env: { PATH: process.env.PATH, HOME: restored.home, PS1: '$ ' }
            });
            const second = new Recorder();
            manager.subscribe('c2', second.sink());
            await manager.create({ sessionId: 'r1', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: restored.home });
            const attached = await manager.attach('r1', 'c2', 80, 24);
            expect(attached.screen).toContain('survives');
            expect(attached.screen).toContain(RESTORED_TEXT);
            expect(attached.screen.indexOf('survives')).toBeLessThan(attached.screen.indexOf(RESTORED_TEXT));

            manager.write('r1', 'echo af""ter\n');
            await waitFor(() => second.output.includes('after'), 'fresh shell answers');
            manager.killAll();
            await waitFor(() => manager.list().every((session) => session.exited), 'restored shell gone');
        } finally {
            await restored.cleanup();
        }
    });

    test('the schedule writes on its timer', async () => {
        await harness.manager.create({ sessionId: 't1', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
        const schedule = scheduleSnapshots(harness.manager, harness.snapshots, 20);
        try {
            let text: string | null = null;
            await waitForAsync(async () => {
                text = await harness.snapshots.read('t1');
                return text !== null;
            }, 'timer snapshot');
        } finally {
            schedule.stop();
        }
    });
});
