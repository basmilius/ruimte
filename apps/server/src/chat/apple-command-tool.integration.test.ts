import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAppleCommand } from './apple-command-tool.ts';

let cwd: string;
beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ruimte-apple-command-'));
});
afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
});

const eventually = async (condition: () => Promise<boolean> | boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The child process did not reach the expected state.');
};

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

describe('Apple local command real process', () => {
    test('runs from the project directory with closed stdin and an explicit environment', async () => {
        const result = await executeAppleCommand(cwd, 'printf "%s|" "$APPLE_TEST"; pwd; if read value; then exit 8; fi', undefined, {
            PATH: '/bin:/usr/bin',
            APPLE_TEST: 'provided'
        });
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.output).output).toContain('provided|');
        expect(JSON.parse(result.output).output).toContain(cwd.replace(/^\/var\//, '/private/var/'));
    });

    test('abort ends the shell and its waiting descendant', async () => {
        const controller = new AbortController();
        const pending = executeAppleCommand(cwd, 'sleep 60 & printf "%s" "$!" > child.pid; wait', controller.signal);
        let childPid = 0;
        try {
            await eventually(async () => {
                childPid = Number(await readFile(join(cwd, 'child.pid'), 'utf8').catch(() => '0'));
                return childPid > 0;
            });
            controller.abort();
            await expect(pending).rejects.toThrow();
            await eventually(() => !alive(childPid));
            expect(alive(childPid)).toBe(false);
        } finally {
            controller.abort();
            await pending.catch(() => undefined);
            if (childPid && alive(childPid)) {
                process.kill(childPid, 'SIGKILL');
            }
        }
    });

    test('timeout stops a real process and keeps its partial output', async () => {
        const result = await executeAppleCommand(cwd, 'printf started; sleep 60', undefined, process.env, {
            scheduleTimeout: (callback, milliseconds) => {
                expect(milliseconds).toBe(30_000);
                const timer = setTimeout(callback, 200);
                return () => clearTimeout(timer);
            }
        });
        expect(result.failed).toBe(true);
        expect(JSON.parse(result.output)).toMatchObject({ timedOut: true, output: 'started', note: 'Command stopped after 30 seconds; output is partial.' });
    });
});
