import { constants } from 'node:os';
import { signalExitCode, type PtyAdapter, type PtyProcess, type PtySpawnOptions } from './pty.ts';

const encoder = new TextEncoder();

/*
 * A PTY that runs nothing: it records what the session layer asks of it and produces output and an
 * exit only when a test says so. There is deliberately no shell behind it, so a test asserts the
 * line the daemon typed rather than what some shell made of that line.
 */
export class FakePty implements PtyProcess {
    readonly pid: number;
    readonly options: PtySpawnOptions;
    readonly input: string[] = [];
    readonly resizes: Array<{ cols: number; rows: number }> = [];
    readonly signals: NodeJS.Signals[] = [];
    // Resolves with the exit code, so a test waits on the event itself instead of polling for it.
    readonly exited: Promise<number>;
    exitCode: number | null = null;
    private dataCallback: ((data: Uint8Array) => void) | null = null;
    private exitCallback: ((exitCode: number) => void) | null = null;
    private resolveExit: (exitCode: number) => void = () => undefined;

    constructor(pid: number, options: PtySpawnOptions) {
        this.pid = pid;
        this.options = options;
        this.exited = new Promise((resolve) => {
            this.resolveExit = resolve;
        });
    }

    /* Everything written into the PTY so far, as one string. */
    get typed(): string {
        return this.input.join('');
    }

    write(data: string): void {
        this.input.push(data);
    }

    resize(cols: number, rows: number): void {
        this.resizes.push({ cols, rows });
    }

    /*
     * Every signal ends the fake, so no test sits out the SIGKILL escalation. The exit is a microtask
     * later because a real process never exits inside the kill call, and `Session.kill` arms its
     * escalation timer after that call returns.
     */
    kill(signal: NodeJS.Signals = 'SIGHUP'): void {
        this.signals.push(signal);
        queueMicrotask(() => this.exit(signalExitCode(signal, constants.signals as Record<string, number>)));
    }

    onData(callback: (data: Uint8Array) => void): void {
        this.dataCallback = callback;
    }

    onExit(callback: (exitCode: number) => void): void {
        this.exitCallback = callback;
    }

    /* Output as if the program in the PTY printed it. */
    emit(text: string): void {
        this.emitBytes(encoder.encode(text));
    }

    /* Raw bytes of one read, for output that splits a character between two reads. */
    emitBytes(bytes: Uint8Array): void {
        if (this.exitCode !== null) {
            throw new Error(`The PTY of pid ${this.pid} has exited`);
        }
        this.dataCallback?.(bytes);
    }

    exit(exitCode: number): void {
        if (this.exitCode !== null) {
            return;
        }
        this.exitCode = exitCode;
        this.resolveExit(exitCode);
        this.exitCallback?.(exitCode);
    }
}

export class FakePtyAdapter implements PtyAdapter {
    readonly spawned: FakePty[] = [];
    private nextPid = 10_000;

    spawn(options: PtySpawnOptions): PtyProcess {
        const pty = new FakePty(this.nextPid++, options);
        this.spawned.push(pty);
        return pty;
    }

    /* The most recent PTY spawned for a session id, which is the live one after a recreate. */
    forSession(sessionId: string): FakePty {
        const pty = this.spawned.findLast((candidate) => candidate.options.env.RUIMTE_SESSION_ID === sessionId);
        if (!pty) {
            throw new Error(`No PTY was spawned for ${sessionId}`);
        }
        return pty;
    }
}
