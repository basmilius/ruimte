import { spawn } from 'node:child_process';
import { createStreamTransport, type LspTransport } from '@ruimte/smart-editor-lsp';

/*
 * How a Node-based server runs without a Node on the machine. A daemon compiled with `bun build
 * --compile` runs as the `bun` CLI when `BUN_BE_BUN=1` is set, so the server's script runs under
 * the daemon's own runtime, and `<runtime> install` installs the pinned packages. Under `bun dev`
 * the executable is bun itself and the variable changes nothing. The variable is inherited, so the
 * servers a server starts (tsserver) run the same way.
 */
export interface LanguageRuntime {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export function bunRuntime(): LanguageRuntime {
    return { command: process.execPath, args: [], env: { BUN_BE_BUN: '1' } };
}

export interface LanguageProcessSpec {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
}

export interface LanguageExit {
    code: number | null;
    signal: string | null;
    /* Why the process never ran, such as a command that does not exist. */
    error?: string;
}

/* A running server process, as far as the host needs to know: what it speaks over, what it says on stderr, and when it ends. */
export interface LanguageChild {
    readonly transport: LspTransport;
    onStderr(listener: (text: string) => void): void;
    readonly exited: Promise<LanguageExit>;
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export type SpawnLanguageProcess = (spec: LanguageProcessSpec) => LanguageChild;

/*
 * The server runs in a process group of its own, so a stop reaches tsserver, which the language
 * server starts, and not only the language server.
 */
export function spawnLanguageProcess(spec: LanguageProcessSpec): LanguageChild {
    const detached = process.platform !== 'win32';
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], detached });
    const closeListeners = new Set<(error?: Error) => void>();
    let ended = false;
    const finish = (error?: Error): void => {
        if (ended) {
            return;
        }
        ended = true;
        for (const listener of closeListeners) {
            listener(error);
        }
    };
    const exited = new Promise<LanguageExit>((resolve) => {
        child.once('error', (error) => {
            finish(error);
            resolve({ code: null, signal: null, error: error.message });
        });
        child.once('close', (code, signal) => {
            finish(code ? new Error(`The process exited with code ${code}`) : undefined);
            resolve({ code, signal });
        });
    });
    child.stdin.on('error', (error) => finish(error));
    const transport = createStreamTransport({
        write: (chunk) =>
            new Promise<void>((resolve, reject) => {
                child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()));
            }),
        onData: (listener) => {
            child.stdout.on('data', listener);
            return { dispose: () => child.stdout.off('data', listener) };
        },
        onClose: (listener) => {
            closeListeners.add(listener);
            return { dispose: () => closeListeners.delete(listener) };
        },
        close: () => {
            child.stdin.destroy();
        }
    });
    return {
        transport,
        onStderr: (listener) => {
            child.stderr.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')));
        },
        exited,
        kill: (signal) => {
            try {
                if (detached && child.pid) {
                    process.kill(-child.pid, signal);
                } else {
                    child.kill(signal);
                }
            } catch {
                // The process is gone already.
            }
        }
    };
}

/* Runs a command to its end and answers its exit code, line by line what it printed. */
export type RunCommand = (spec: LanguageProcessSpec, onLine: (line: string) => void) => Promise<number>;

export const runCommand: RunCommand = (spec, onLine) =>
    new Promise((resolve, reject) => {
        const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let pending = '';
        const read = (chunk: Buffer): void => {
            pending += chunk.toString('utf8');
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() ?? '';
            lines.forEach(onLine);
        };
        child.stdout.on('data', read);
        child.stderr.on('data', read);
        child.once('error', reject);
        child.once('close', (code) => {
            if (pending !== '') {
                onLine(pending);
            }
            resolve(code ?? 1);
        });
    });
