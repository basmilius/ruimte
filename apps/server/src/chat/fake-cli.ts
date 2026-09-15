import type { ChatProcess, ChatSpawnOptions, SpawnChatProcess } from './chat-process.ts';

/* What a fake CLI has instead of `process`, so the same fake runs in a test and as a child process. */
export interface FakeIo {
    // The arguments after the executable.
    readonly argv: string[];
    readonly cwd: string;
    out(frame: unknown): void;
    // Nothing the fake writes after this reaches the backend; the caller returns right after.
    exit(code: number): void;
    // Work the real CLI does later on its own; in a test, the test says when later is.
    later(work: () => void): void;
}

export interface FakeProgram {
    onLine(line: string): void;
}

export type FakeCli = (io: FakeIo) => FakeProgram;

export interface StartedFake {
    readonly argv: string[];
    // Runs what the fake put off with `later`, in the order it was put off.
    runLater(): void;
    // Settles once the backend has heard the exit and read everything written before it.
    readonly exited: Promise<number | null>;
}

export interface InProcessCli {
    spawn: SpawnChatProcess;
    // Every fake this spawn started, oldest first.
    readonly started: StartedFake[];
}

/*
 * A spawn that runs the fake in this process. A line written to stdin reaches the fake at once, and
 * stdout is pulled: the exit is reported only after the backend has read every frame written before
 * it, which is the order a real pipe delivers them in and leaves nothing to a clock.
 */
export const inProcess = (cli: FakeCli): InProcessCli => {
    const started: StartedFake[] = [];
    let nextPid = 900_000;
    const spawn = (options: ChatSpawnOptions): ChatProcess => {
        const encoder = new TextEncoder();
        const chunks: Uint8Array[] = [];
        const deferred: Array<() => void> = [];
        let ended = false;
        let exitCode: number | null = null;
        let inputClosed = false;
        let pending = '';
        let wake: (() => void) | null = null;
        let settleExited: (code: number | null) => void = () => undefined;
        const exited = new Promise<number | null>((resolve) => {
            settleExited = resolve;
        });
        const nudge = (): void => {
            const waiting = wake;
            wake = null;
            waiting?.();
        };
        const exit = (code: number | null): void => {
            if (ended) {
                return;
            }
            ended = true;
            exitCode = code;
            nudge();
        };
        const program = cli({
            argv: options.command.slice(1),
            cwd: options.cwd,
            out: (frame) => {
                if (ended) {
                    return;
                }
                chunks.push(encoder.encode(`${JSON.stringify(frame)}\n`));
                nudge();
            },
            exit: (code) => exit(code),
            later: (work) => {
                deferred.push(work);
            }
        });
        const stdout = new ReadableStream<Uint8Array>(
            {
                pull: async (controller) => {
                    while (chunks.length === 0 && !ended) {
                        await new Promise<void>((resolve) => {
                            wake = resolve;
                        });
                    }
                    const chunk = chunks.shift();
                    if (chunk) {
                        controller.enqueue(chunk);
                        return;
                    }
                    controller.close();
                    options.onExit(exitCode);
                    settleExited(exitCode);
                }
            },
            { highWaterMark: 0 }
        );
        const stdin = {
            write: (chunk: string): number => {
                if (ended || inputClosed) {
                    return 0;
                }
                pending += chunk;
                let newline = pending.indexOf('\n');
                while (newline >= 0 && !ended) {
                    const line = pending.slice(0, newline);
                    pending = pending.slice(newline + 1);
                    newline = pending.indexOf('\n');
                    if (line.trim() !== '') {
                        program.onLine(line);
                    }
                }
                return chunk.length;
            },
            flush: (): number => 0,
            // Both fakes leave the way the real CLIs do once their input is gone.
            end: (): number => {
                inputClosed = true;
                exit(0);
                return 0;
            }
        };
        started.push({
            argv: options.command.slice(1),
            runLater: () => {
                for (const work of deferred.splice(0)) {
                    work();
                }
            },
            exited
        });
        return {
            pid: nextPid++,
            stdin,
            stdout,
            // A signal ends a real process without an exit code of its own.
            kill: () => exit(null)
        };
    };
    return { spawn, started };
};

/* The same fake as a child process, for the one test that needs real pipes and a real exit code. */
export const runOverStdio = async (cli: FakeCli): Promise<void> => {
    const program = cli({
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        out: (frame) => {
            process.stdout.write(`${JSON.stringify(frame)}\n`);
        },
        exit: (code) => process.exit(code),
        later: (work) => {
            setImmediate(work);
        }
    });
    const decoder = new TextDecoder();
    let buffered = '';
    for await (const chunk of Bun.stdin.stream()) {
        buffered += decoder.decode(chunk, { stream: true });
        let newline = buffered.indexOf('\n');
        while (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            newline = buffered.indexOf('\n');
            if (line.trim() !== '') {
                program.onLine(line);
            }
        }
    }
    process.exit(0);
};
