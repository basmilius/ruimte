import { spawn } from 'node:child_process';

/* One program of a machine start, as it runs: no shell reads it, so each argument arrives as it was described. */
export interface MachineStepRun {
    command: string;
    args: readonly string[];
    cwd: string;
    env: Record<string, string | undefined>;
}

interface MachineStepHooks {
    /* A line the program wrote, on either stream. */
    line(text: string): void;
    /* Aborted by a person's stop, which asks the program to end once and waits for it. */
    signal: AbortSignal;
}

/* Runs a program to its end and answers its exit code, or null for one a signal ended. Rejects when it could not start. */
export type RunMachineStep = (step: MachineStepRun, hooks: MachineStepHooks) => Promise<number | null>;

function lineReader(line: (text: string) => void): { read(chunk: string): void; end(): void } {
    let buffered = '';

    return {
        read(chunk) {
            buffered += chunk;

            for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
                line(buffered.slice(0, end).replace(/\r$/, ''));
                buffered = buffered.slice(end + 1);
            }
        },
        end() {
            if (buffered !== '') {
                line(buffered);
            }
        }
    };
}

/*
 * The real runner. A stop sends SIGTERM once and nothing after it: a program that does not end on it keeps the start
 * waiting, where a person sees it, since Ruimte never sends a signal nobody pressed.
 */
export const runMachineStep: RunMachineStep = (step, hooks) =>
    new Promise((resolve, reject) => {
        const child = spawn(step.command, [...step.args], { cwd: step.cwd, env: step.env, stdio: ['ignore', 'pipe', 'pipe'] });
        const out = lineReader(hooks.line);
        const err = lineReader(hooks.line);
        const stop = (): void => void child.kill('SIGTERM');

        hooks.signal.addEventListener('abort', stop);
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => out.read(chunk));
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => err.read(chunk));
        child.on('error', (e) => {
            hooks.signal.removeEventListener('abort', stop);
            reject(e);
        });
        // `close` rather than `exit`, so the last lines of both streams are in before the code is.
        child.on('close', (code) => {
            hooks.signal.removeEventListener('abort', stop);
            out.end();
            err.end();
            resolve(code);
        });

        if (hooks.signal.aborted) {
            stop();
        }
    });
