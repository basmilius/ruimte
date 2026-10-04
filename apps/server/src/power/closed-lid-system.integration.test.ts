import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { waitFor } from '../sessions/test-helpers.ts';
import { PMSET, watchdogCommand, type PowerState } from './closed-lid.ts';
import { spawnWatchdog, streamPower } from './closed-lid-system.ts';

/*
 * What no fake can prove: that the watchdog notices a daemon that is gone without polling, and that it
 * stays put for a terminal's signals. Its command is a `touch` here, never sudo or pmset.
 */

let dir: string;
let fired: string;
const strays: number[] = [];

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ruimte-closed-lid-'));
    fired = join(dir, 'fired');
});

afterEach(async () => {
    for (const pid of strays.splice(0)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // Already gone.
        }
    }
    await rm(dir, { recursive: true, force: true });
});

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

/* Reads the first lines a process prints, as many as asked for. */
const firstLines = async (stream: ReadableStream<Uint8Array>, count: number): Promise<string[]> => {
    const decoder = new TextDecoder();
    let text = '';
    for await (const chunk of stream) {
        text += decoder.decode(chunk, { stream: true });
        if (text.split('\n').length > count) {
            break;
        }
    }
    return text.split('\n').slice(0, count);
};

describe('the closed-lid watchdog', () => {
    test('runs its command once the process holding it is killed outright, though a child of that process lives on', async () => {
        const holder = join(dir, 'holder.ts');
        await writeFile(
            holder,
            [
                `import { spawnWatchdog } from ${JSON.stringify(join(import.meta.dir, 'closed-lid-system.ts'))};`,
                `import { watchdogCommand } from ${JSON.stringify(join(import.meta.dir, 'closed-lid.ts'))};`,
                `const watchdog = spawnWatchdog(watchdogCommand(['/usr/bin/touch', ${JSON.stringify(fired)}]));`,
                // Started after the watchdog, as a terminal of the daemon would be: it must not hold the pipe open.
                `const child = Bun.spawn(['/bin/sleep', '60'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });`,
                'console.log(watchdog.pid);',
                'console.log(child.pid);',
                'setInterval(() => watchdog, 1000);'
            ].join('\n')
        );
        const daemon = Bun.spawn([process.execPath, holder], { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' });
        strays.push(daemon.pid);
        const [watchdogPid, childPid] = (await firstLines(daemon.stdout, 2)).map(Number);
        strays.push(watchdogPid!, childPid!);
        expect(existsSync(fired)).toBe(false);

        daemon.kill('SIGKILL');
        await daemon.exited;
        await waitFor(() => existsSync(fired), 'the watchdog to run its command');
        expect(alive(childPid!)).toBe(true);
        await waitFor(() => !alive(watchdogPid!), 'the watchdog to end');
    });

    test('ignores the signals a terminal sends, and a dismissed one never runs its command', async () => {
        const watchdog = spawnWatchdog(watchdogCommand(['/usr/bin/touch', fired]));
        strays.push(watchdog.pid);
        // A signal before the shell ran its first command meets no trap yet.
        await Bun.sleep(200);
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
            process.kill(watchdog.pid, signal);
        }
        await Bun.sleep(200);
        expect(alive(watchdog.pid)).toBe(true);
        watchdog.dismiss();
        await watchdog.exited;
        expect(existsSync(fired)).toBe(false);
    });
});

/* Only a Mac with a battery of its own reports its power source in a stream; a virtual one in CI stays silent. */
const hasBattery = process.platform === 'darwin' && /-InternalBattery-/.test(Bun.spawnSync([PMSET, '-g', 'ps']).stdout.toString());

describe.skipIf(!hasBattery)('the power source stream', () => {
    test('says where the power comes from as soon as it starts', async () => {
        const readings: (PowerState | null)[] = [];
        const stream = streamPower((power) => readings.push(power));
        try {
            await waitFor(() => readings.length > 0, 'a first reading');
            expect(readings[0]).toMatchObject({ adapter: expect.any(Boolean) });
        } finally {
            stream.stop();
        }
    });
});
