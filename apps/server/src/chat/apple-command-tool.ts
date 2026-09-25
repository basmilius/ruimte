import type { AppleToolResult } from './apple-tools.ts';

export interface AppleCommandProcess {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    killGroup(): void;
}

export interface AppleCommandDependencies {
    spawn(cwd: string, command: string, env: Record<string, string | undefined>): AppleCommandProcess;
    scheduleTimeout(callback: () => void, milliseconds: number): () => void;
}

const defaults: AppleCommandDependencies = {
    spawn: (cwd, command, env) => {
        // Approval permits a local shell command; cwd is not an operating system sandbox.
        const process = Bun.spawn(['/bin/sh', '-c', command], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', detached: true });
        return {
            stdout: process.stdout,
            stderr: process.stderr,
            exited: process.exited,
            killGroup: () => {
                try {
                    globalThis.process.kill(-process.pid, 'SIGKILL');
                } catch {
                    // The process group may already be gone.
                }
            }
        };
    },
    scheduleTimeout: (callback, milliseconds) => {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
    }
};

export const executeAppleCommand = async (
    cwd: string,
    command: string,
    signal?: AbortSignal,
    env: Record<string, string | undefined> = process.env,
    dependencies: Partial<AppleCommandDependencies> = {}
): Promise<AppleToolResult> => {
    signal?.throwIfAborted();
    if (!command.trim() || Buffer.byteLength(command) > 16_000 || command.includes('\0')) {
        throw new Error('Use a nonempty shell command of at most 16000 bytes.');
    }
    const child = (dependencies.spawn ?? defaults.spawn)(cwd, command, env);
    const retained: Uint8Array[] = [];
    let retainedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let stopped = false;
    let settleStop!: () => void;
    const stoppedPromise = new Promise<void>((resolve) => {
        settleStop = resolve;
    });
    const readers = [child.stdout.getReader(), child.stderr.getReader()];
    const stop = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        child.killGroup();
        for (const reader of readers) {
            void reader.cancel().catch(() => undefined);
        }
        settleStop();
    };
    const cancelTimeout = (dependencies.scheduleTimeout ?? defaults.scheduleTimeout)(() => {
        timedOut = true;
        stop();
    }, 30_000);
    signal?.addEventListener('abort', stop, { once: true });
    const drain = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                const remaining = Math.max(0, 4500 - retainedBytes);
                if (value.length > remaining) {
                    truncated = true;
                }
                if (remaining > 0) {
                    const bytes = value.slice(0, remaining);
                    retained.push(bytes);
                    retainedBytes += bytes.length;
                }
            }
        } catch {
            if (!stopped) {
                truncated = true;
            }
        }
    };
    try {
        if (signal?.aborted) {
            stop();
        }
        const draining = Promise.all(readers.map(drain));
        const completed = child.exited.then(async (code) => {
            // A shell can exit while a background child still holds its output pipes.
            child.killGroup();
            await draining;
            return code;
        });
        const exitCode = await Promise.race([completed, stoppedPromise.then(() => null)]);
        signal?.throwIfAborted();
        let output = new TextDecoder().decode(Buffer.concat(retained));
        const serialized = () =>
            JSON.stringify({
                exitCode,
                timedOut,
                truncated,
                output,
                ...(timedOut ? { note: 'Command stopped after 30 seconds; output is partial.' } : truncated ? { note: 'Output was truncated.' } : {})
            });
        while (Buffer.byteLength(serialized()) > 6000) {
            truncated = true;
            output = output.slice(0, Math.floor(output.length * 0.9));
        }
        return {
            output: serialized(),
            failed: timedOut || exitCode !== 0
        };
    } finally {
        cancelTimeout();
        signal?.removeEventListener('abort', stop);
        stop();
    }
};
