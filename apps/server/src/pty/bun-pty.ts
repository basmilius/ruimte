import { constants } from 'node:os';
import { signalExitCode, type PtyAdapter, type PtyProcess, type PtySpawnOptions } from './pty.ts';

// A backgrounded grandchild may keep the PTY open forever, so only wait briefly for trailing output.
const PTY_DRAIN_GRACE_MS = 250;

class BunPtyProcess implements PtyProcess {
    readonly pid: number;
    private readonly process: ReturnType<typeof Bun.spawn>;
    private dataCallback: ((data: Uint8Array) => void) | null = null;
    private exitCallback: ((exitCode: number) => void) | null = null;
    private ptyClosed = false;
    private processExitCode: number | null = null;
    private exitReported = false;
    private drainTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: PtySpawnOptions) {
        this.process = Bun.spawn([options.shell, ...options.args], {
            cwd: options.cwd,
            env: options.env,
            terminal: {
                cols: options.cols,
                rows: options.rows,
                name: options.env.TERM ?? 'xterm-256color',
                data: (_terminal, data) => {
                    this.dataCallback?.(data);
                },
                exit: () => {
                    this.ptyClosed = true;
                    this.reportExitIfDone();
                }
            },
            onExit: (_subprocess, exitCode, signalCode) => {
                this.processExitCode = exitCode ?? signalExitCode(String(signalCode), constants.signals as Record<string, number>);
                this.reportExitIfDone();
            }
        });
        this.pid = this.process.pid;
    }

    write(data: string): void {
        this.process.terminal?.write(data);
    }

    resize(cols: number, rows: number): void {
        this.process.terminal?.resize(cols, rows);
    }

    kill(signal: NodeJS.Signals = 'SIGHUP'): void {
        if (this.processExitCode !== null) {
            return;
        }
        this.process.kill(signal);
    }

    onData(callback: (data: Uint8Array) => void): void {
        this.dataCallback = callback;
    }

    onExit(callback: (exitCode: number) => void): void {
        this.exitCallback = callback;
    }

    private reportExitIfDone(): void {
        if (this.exitReported || this.processExitCode === null) {
            return;
        }
        if (!this.ptyClosed && this.drainTimer === null) {
            this.drainTimer = setTimeout(() => this.finishExit(), PTY_DRAIN_GRACE_MS);
            return;
        }
        this.finishExit();
    }

    private finishExit(): void {
        if (this.exitReported) {
            return;
        }
        this.exitReported = true;
        if (this.drainTimer !== null) {
            clearTimeout(this.drainTimer);
            this.drainTimer = null;
        }
        // Closing the master side is what lets the event loop and any lingering grandchild go.
        this.process.terminal?.close();
        this.exitCallback?.(this.processExitCode ?? 0);
    }
}

export class BunPtyAdapter implements PtyAdapter {
    spawn(options: PtySpawnOptions): PtyProcess {
        return new BunPtyProcess(options);
    }
}
