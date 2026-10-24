import { describe, expect, test } from 'bun:test';
import { createPtyKill, type KillSpawner, type PtyKillTarget } from './pty-kill.ts';

interface Harness {
    readonly target: PtyKillTarget;
    readonly written: string[];
    readonly signals: NodeJS.Signals[];
    readonly spawned: string[][];
    readonly spawn: KillSpawner;
    finishTaskkill(): Promise<void>;
    exit(): void;
}

function harness(): Harness {
    const written: string[] = [];
    const signals: NodeJS.Signals[] = [];
    const spawned: string[][] = [];
    const running: Array<{ promise: Promise<number>; resolve: (code: number) => void }> = [];
    let exited = false;
    const target: PtyKillTarget = {
        pid: 4242,
        hasExited: () => exited,
        write: (data) => {
            written.push(data);
        },
        signal: (signal) => {
            signals.push(signal);
        }
    };
    const spawn: KillSpawner = (argv) => {
        spawned.push(argv);
        const run = Promise.withResolvers<number>();
        running.push(run);
        return { exited: run.promise };
    };
    return {
        target,
        written,
        signals,
        spawned,
        spawn,
        finishTaskkill: async () => {
            const run = running.shift();
            if (run === undefined) {
                return;
            }
            run.resolve(0);
            // The kill's own handler was attached first, so it has run once this resolves.
            await run.promise;
        },
        exit: () => {
            exited = true;
        }
    };
}

describe('createPtyKill on Windows', () => {
    test('SIGINT writes a Ctrl+C and starts nothing', () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn }).kill;
        kill('SIGINT');
        expect(pty.written).toEqual(['\x03']);
        expect(pty.spawned).toEqual([]);
        expect(pty.signals).toEqual([]);
    });

    test('any other signal starts taskkill on the whole tree and returns before it ends', () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn }).kill;
        kill('SIGHUP');
        expect(pty.spawned).toEqual([['taskkill', '/PID', '4242', '/T', '/F']]);
        expect(pty.signals).toEqual([]);
        expect(pty.written).toEqual([]);
    });

    test('falls back to SIGKILL once taskkill ended and the process is still there', async () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn }).kill;
        kill('SIGTERM');
        await pty.finishTaskkill();
        expect(pty.signals).toEqual(['SIGKILL']);
    });

    test('sends nothing after taskkill when it ended the process', async () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn }).kill;
        kill('SIGTERM');
        pty.exit();
        await pty.finishTaskkill();
        expect(pty.signals).toEqual([]);
    });

    test('starts no second taskkill while the first still runs', async () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn }).kill;
        kill('SIGHUP');
        kill('SIGKILL');
        expect(pty.spawned).toHaveLength(1);
        await pty.finishTaskkill();
        kill('SIGKILL');
        expect(pty.spawned).toHaveLength(2);
    });

    test('sends SIGKILL at once when taskkill cannot be started', () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, {
            platform: 'win32',
            spawn: () => {
                throw new Error('taskkill: not found');
            }
        }).kill;
        kill('SIGHUP');
        expect(pty.signals).toEqual(['SIGKILL']);
        kill('SIGHUP');
        expect(pty.signals).toEqual(['SIGKILL', 'SIGKILL']);
    });
});

describe('createPtyKill settled', () => {
    test('settles at once when no taskkill runs', async () => {
        const pty = harness();
        const killer = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn });
        await killer.settled();
        killer.kill('SIGINT');
        await killer.settled();
        expect(pty.spawned).toEqual([]);
    });

    test('settles once taskkill and the SIGKILL after it are done', async () => {
        const pty = harness();
        const killer = createPtyKill(pty.target, { platform: 'win32', spawn: pty.spawn });
        killer.kill('SIGHUP');
        let settled = false;
        const settling = killer.settled().then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        await pty.finishTaskkill();
        await settling;
        expect(pty.signals).toEqual(['SIGKILL']);
    });
});

describe('createPtyKill elsewhere', () => {
    test('passes the signal on and starts nothing', () => {
        const pty = harness();
        const kill = createPtyKill(pty.target, { platform: 'darwin', spawn: pty.spawn }).kill;
        kill('SIGINT');
        kill('SIGHUP');
        expect(pty.signals).toEqual(['SIGINT', 'SIGHUP']);
        expect(pty.written).toEqual([]);
        expect(pty.spawned).toEqual([]);
    });
});

test.each(['win32', 'linux'])('createPtyKill on %s does nothing once the process exited', (platform) => {
    const pty = harness();
    const kill = createPtyKill(pty.target, { platform, spawn: pty.spawn }).kill;
    pty.exit();
    kill('SIGINT');
    kill('SIGHUP');
    expect(pty.written).toEqual([]);
    expect(pty.spawned).toEqual([]);
    expect(pty.signals).toEqual([]);
});
