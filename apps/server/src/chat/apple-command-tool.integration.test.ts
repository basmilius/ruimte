import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor, waitForAsync } from '../sessions/test-helpers.ts';
import { executeAppleCommand } from './apple-command-tool.ts';
import { killQuietly, processAlive } from '../process-test-helpers.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

let cwd: string;
const newHome = tempHomes('ruimte-apple-command-');

beforeEach(async () => {
    cwd = await newHome();
});
describe.skipIf(process.platform === 'win32')('Apple local command real process', () => {
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
            await waitForAsync(async () => {
                childPid = Number(await readFile(join(cwd, 'child.pid'), 'utf8').catch(() => '0'));
                return childPid > 0;
            }, 'the child process to write its id');
            controller.abort();
            await expect(pending).rejects.toThrow();
            await waitFor(() => !processAlive(childPid), 'the child process to end');
            expect(processAlive(childPid)).toBe(false);
        } finally {
            controller.abort();
            await pending.catch(() => undefined);
            if (childPid > 0) {
                killQuietly(childPid);
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
