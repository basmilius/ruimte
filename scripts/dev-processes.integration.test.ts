import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { scheduleForcedStop, stopOwnedProcess } from './dev-processes';

const running: ChildProcess[] = [];

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const waitForExit = async (pid: number): Promise<void> => {
    const deadline = Date.now() + 3000;
    while (isAlive(pid) && Date.now() < deadline) {
        await Bun.sleep(20);
    }
};

afterEach(() => {
    for (const child of running) {
        stopOwnedProcess(child, 'SIGKILL');
    }
    running.length = 0;
});

describe.skipIf(process.platform === 'win32')('development process cleanup integration', () => {
    test('kills a stubborn descendant after its group leader exits without touching another group', async () => {
        const parent = spawn(
            process.execPath,
            [
                '-e',
                `const { spawn } = require('node:child_process');
                 const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
                 process.stdout.write(String(child.pid) + '\\n');
                 setInterval(() => {}, 1000);`
            ],
            { detached: true, stdio: ['ignore', 'pipe', 'inherit'] }
        );
        const control = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            detached: true,
            stdio: 'ignore'
        });
        running.push(parent, control);
        const descendantPid = await new Promise<number>((resolve, reject) => {
            parent.once('error', reject);
            parent.stdout?.once('data', (chunk) => resolve(Number(String(chunk).trim())));
        });

        expect(isAlive(parent.pid!)).toBeTrue();
        expect(isAlive(descendantPid)).toBeTrue();
        expect(isAlive(control.pid!)).toBeTrue();

        stopOwnedProcess(parent, 'SIGTERM');
        await once(parent, 'exit');

        expect(isAlive(parent.pid!)).toBeFalse();
        expect(isAlive(descendantPid)).toBeTrue();
        const deadline = scheduleForcedStop([parent], 10);
        await waitForExit(descendantPid);
        clearTimeout(deadline);

        expect(isAlive(descendantPid)).toBeFalse();
        expect(isAlive(control.pid!)).toBeTrue();
    });
});
