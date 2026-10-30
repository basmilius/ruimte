import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { join } from 'node:path';
import { killQuietly } from '../process-test-helpers.ts';
import { waitFor } from '../sessions/test-helpers.ts';

/* A pre-commit hook that writes its pid to `pidFile`, prints `ready` and waits on a pipe nobody writes to, the way a hung hook does. */
export async function installHangingHook(repo: string, pidFile: string, ready: string): Promise<void> {
    const fifo = `${pidFile}.fifo`;
    expect(await Bun.spawn(['mkfifo', fifo]).exited).toBe(0);
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, `#!/bin/sh\n{ cat /proc/$$/winpid 2>/dev/null || echo $$; } > '${pidFile}'\necho ${ready}\nread line < '${fifo}'\n`);
    await chmod(hook, 0o755);
}

/* Takes down the process whose pid is in `pidFile` if the code under test did not, so nothing outlives the test. */
export async function killFromPidFile(pidFile: string): Promise<void> {
    const pid = Number.parseInt((await readFile(pidFile, 'utf8').catch(() => '')).trim(), 10);
    if (!Number.isFinite(pid)) {
        return;
    }
    killQuietly(pid);
}

export async function expectProcessTerminated(pid: number, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    await waitFor(() => {
        try {
            process.kill(pid, 0);
        } catch (error) {
            expect(error).toHaveProperty('code', 'ESRCH');
            return true;
        }

        if (process.platform !== 'linux') {
            return false;
        }
        // Linux retains an orphan's PID until init reaps it, even though it has terminated.
        let stat: string;
        try {
            stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        } catch (error) {
            // Reaping between procfs lookup and read yields ESRCH instead of ENOENT.
            expect(['ENOENT', 'ESRCH']).toContain((error as NodeJS.ErrnoException).code ?? '');
            return true;
        }
        const fields = stat
            .slice(stat.lastIndexOf(')') + 2)
            .trim()
            .split(/\s+/);
        if (fields[0] !== 'Z') {
            return false;
        }
        // Fields 3 and 52 are the state and waitpid exit status, after the parenthesized name.
        expect(Number(fields[49])).toBe(constants.signals[signal]);
        return true;
    }, `process ${pid} to terminate`);
}
