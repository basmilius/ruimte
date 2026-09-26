import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

/*
 * The part of a child process a chat backend talks to: lines in over stdin, lines out over stdout,
 * a signal and an exit. A test hands in a CLI that runs in the same process instead of a real one.
 */
export interface ChatProcess {
    readonly pid: number;
    readonly stdin: {
        write(chunk: string): unknown;
        flush(): unknown;
        end(): unknown;
    };
    readonly stdout: ReadableStream<Uint8Array>;
    // Only read for the tail a crash note carries; a fake that never writes there may leave it out.
    readonly stderr?: ReadableStream<Uint8Array>;
    // Reaches every process the CLI started as well, which share its process group.
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface ChatSpawnOptions {
    command: string[];
    cwd: string;
    env: Record<string, string>;
    onExit(exitCode: number | null): void;
}

export type SpawnChatProcess = (options: ChatSpawnOptions) => ChatProcess;

// How long an exit waits for the rest of stdout; a process the CLI started may hold the pipe open.
const STDOUT_DRAIN_MS = 250;

export const spawnChatProcess: SpawnChatProcess = (options) => {
    const [command, ...args] = options.command;
    if (command === undefined) {
        throw new Error('No command to start');
    }
    const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // A group of its own, so ending the chat also ends what its agent started (a dev server, a watcher).
        detached: true
    });
    // Node reports a missing executable as an event after the call; a start that failed says so on the spot.
    child.on('error', () => undefined);
    const pid = child.pid;
    if (pid === undefined) {
        throw new Error(`Could not start ${command}: no such executable`);
    }
    // A write to a CLI that just went fails on the pipe, which the exit already reports.
    child.stdin.on('error', () => undefined);
    child.on('exit', (exitCode) => {
        // The last lines may still be on their way through the pipe; they belong before the exit.
        const report = (): void => {
            clearTimeout(timer);
            child.stdout.off('end', report);
            setImmediate(() => options.onExit(exitCode));
        };
        const timer = setTimeout(report, STDOUT_DRAIN_MS);
        if (child.stdout.readableEnded) {
            report();
            return;
        }
        child.stdout.once('end', report);
    });
    return {
        pid,
        stdin: {
            write: (chunk) => child.stdin.write(chunk),
            flush: () => undefined,
            end: () => child.stdin.end()
        },
        stdout: Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
        stderr: Readable.toWeb(child.stderr) as unknown as ReadableStream<Uint8Array>,
        kill: (signal) => {
            try {
                process.kill(-pid, signal);
            } catch {
                // Nothing of the group is left to signal.
            }
        }
    };
};

// After stdin closed, a CLI that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;
// What a CLI and everything it started get between the SIGTERM and the SIGKILL.
const KILL_GRACE_MS = 2000;
// How long a crash note waits for the last of stderr; a process the CLI started may hold the pipe open.
const STDERR_DRAIN_MS = 250;
// A pipe nobody reads is buffered in memory for as long as the CLI lives, so stderr is read into this much and no more.
const STDERR_TAIL_CHARS = 8 * 1024;
// What of that tail goes into the note, which the log and every client carry.
const NOTE_TAIL_LINES = 10;
const NOTE_TAIL_CHARS = 2000;

/* The last few kilobytes a stream carried. */
export class StreamTail {
    readonly done: Promise<void>;
    private text = '';

    constructor(stream: ReadableStream<Uint8Array>) {
        this.done = this.read(stream);
    }

    /* The last lines, short enough for a note; null when nothing but whitespace came. */
    lines(): string | null {
        const lines = this.text
            .split('\n')
            .map((line) => line.trimEnd())
            .filter((line) => line.trim() !== '')
            .slice(-NOTE_TAIL_LINES);
        const tail = lines.join('\n').slice(-NOTE_TAIL_CHARS);
        return tail === '' ? null : tail;
    }

    private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                this.text = (this.text + decoder.decode(value, { stream: true })).slice(-STDERR_TAIL_CHARS);
            }
        } catch {
            // The pipe went with the process; what came before it is still the tail.
        }
    }
}

export interface ChatChildOptions extends Omit<ChatSpawnOptions, 'onExit'> {
    spawn?: SpawnChatProcess;
    // `stderr` is the tail of what the CLI wrote there, for an exit with an error code only.
    onExit(exitCode: number | null, stderr: string | null): void;
}

/*
 * A spawned CLI and how it ends. Every signal goes to its process group, SIGTERM first and SIGKILL
 * after a grace, and only ever because a person stopped, removed or restarted something.
 */
export class ChatChild {
    readonly process: ChatProcess;
    // Settles when the CLI itself exited, not when its report of that was delivered.
    readonly exited: Promise<void>;
    private readonly tail: StreamTail | null;
    private hasExited = false;
    private graceTimer: ReturnType<typeof setTimeout> | null = null;
    private ending: Promise<void> | null = null;

    constructor(options: ChatChildOptions) {
        let settle: () => void = () => undefined;
        this.exited = new Promise((resolve) => {
            settle = resolve;
        });
        const spawn = options.spawn ?? spawnChatProcess;
        this.process = spawn({
            command: options.command,
            cwd: options.cwd,
            env: options.env,
            onExit: (exitCode) => {
                this.hasExited = true;
                this.clearGrace();
                settle();
                void this.report(exitCode, options.onExit);
            }
        });
        this.tail = this.process.stderr ? new StreamTail(this.process.stderr) : null;
    }

    get pid(): number {
        return this.process.pid;
    }

    /* Ends the CLI once the grace is over and it has not left on its own; the caller closed its input. */
    endAfterGrace(): void {
        if (this.hasExited || this.graceTimer !== null || this.ending !== null) {
            return;
        }
        this.graceTimer = setTimeout(() => {
            this.graceTimer = null;
            void this.end();
        }, EXIT_GRACE_MS);
        this.graceTimer.unref?.();
    }

    /* SIGTERM to the group now and SIGKILL after the grace; settles once the CLI exited or was sent the SIGKILL. */
    end(): Promise<void> {
        this.clearGrace();
        if (this.hasExited) {
            return Promise.resolve();
        }
        if (this.ending === null) {
            this.process.kill('SIGTERM');
            this.ending = new Promise((resolve) => {
                // Sent even when the CLI left in time: what it started may still be shutting down, or ignoring the SIGTERM.
                const timer = setTimeout(() => {
                    this.process.kill('SIGKILL');
                    resolve();
                }, KILL_GRACE_MS);
                timer.unref?.();
                void this.exited.then(resolve);
            });
        }
        return this.ending;
    }

    private clearGrace(): void {
        if (this.graceTimer !== null) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }
    }

    private async report(exitCode: number | null, onExit: ChatChildOptions['onExit']): Promise<void> {
        if (exitCode === null || exitCode === 0 || this.tail === null) {
            onExit(exitCode, null);
            return;
        }
        let release: () => void = () => undefined;
        const timer = setTimeout(() => release(), STDERR_DRAIN_MS);
        await Promise.race([
            this.tail.done,
            new Promise<void>((resolve) => {
                release = resolve;
            })
        ]);
        clearTimeout(timer);
        onExit(exitCode, this.tail.lines());
    }
}
