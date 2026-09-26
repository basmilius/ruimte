import { spawn } from 'node:child_process';

export interface ProcessResult {
    // Null when the process ended on a signal.
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

export interface RunProcessOptions {
    env?: Record<string, string | undefined>;
    cwd?: string;
    // Written and closed at once; absent, the process reads from nothing.
    stdin?: string;
    // The process is sent a SIGTERM after this, and the run fails.
    timeoutMs?: number;
    timeoutMessage?: string;
}

/* One short command to its end, with what it printed. A command that cannot start rejects. */
export const runProcess = (command: readonly string[], options: RunProcessOptions = {}): Promise<ProcessResult> =>
    new Promise((resolve, reject) => {
        const [executable, ...args] = command;
        if (executable === undefined) {
            reject(new Error('No command to run'));
            return;
        }
        const child = spawn(executable, args, {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.env === undefined ? {} : { env: options.env }),
            stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
        const timer =
            options.timeoutMs === undefined
                ? null
                : setTimeout(() => {
                      child.kill('SIGTERM');
                      reject(new Error(options.timeoutMessage ?? `${executable} did not finish in time`));
                  }, options.timeoutMs);
        child.on('error', (error) => {
            if (timer !== null) {
                clearTimeout(timer);
            }
            reject(error);
        });
        child.on('close', (exitCode) => {
            if (timer !== null) {
                clearTimeout(timer);
            }
            resolve({ exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
        });
        if (options.stdin !== undefined && child.stdin) {
            child.stdin.on('error', () => undefined);
            child.stdin.end(options.stdin);
        }
    });
