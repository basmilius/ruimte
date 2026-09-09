import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import type { AgentInfo } from '@ruimte/contracts';
import type { PtyAdapter, PtyProcess } from '../pty/pty.ts';

export const SCROLLBACK_LINES = 10_000;

// Roughly one animation frame: enough to fold a burst of small PTY reads into one frame on the
// wire without adding a delay anyone can see.
export const OUTPUT_TICK_MS = 16;

// A shell that traps SIGHUP would otherwise keep a killed session alive forever.
export const KILL_ESCALATION_MS = 2000;

export const RESTORED_TEXT = '[session restored, previous shell ended]';
export const RESTORED_MARKER = `\r\n\x1b[2m${RESTORED_TEXT}\x1b[0m\r\n`;

export interface SessionOptions {
    id: string;
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
    adapter: PtyAdapter;
    // Screen text of a previous life of this id; shown above the fresh shell with the restored marker.
    restoredScreen?: string;
    // The agent a previous life of this id ran; offered for resume, never started on its own.
    restoredAgent?: AgentInfo;
    // First line typed into the shell, so a node can open straight into a program.
    command?: string;
    // Shown dimmed above the first prompt, for what the shell cannot tell on its own (the linked context).
    motd?: string;
    hookToken: string;
    deliver(clientId: string, data: string): void;
    onExit(exitCode: number): void;
}

export class Session {
    readonly id: string;
    readonly cwd: string;
    readonly pid: number;
    readonly createdAt: number;
    cols: number;
    rows: number;
    exitCode: number | null = null;
    // What a hook POST must carry to speak for this session; only the shell's environment knows it.
    readonly hookToken: string;
    agent: AgentInfo | null;
    private readonly terminal: Terminal;
    private readonly serializer: SerializeAddon;
    private readonly pty: PtyProcess;
    private readonly deliver: (clientId: string, data: string) => void;
    private readonly onExit: (exitCode: number) => void;
    private readonly pending = new Map<string, string>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private killTimer: ReturnType<typeof setTimeout> | null = null;
    // Bytes of one UTF-8 character can straddle two PTY reads; the streaming decoder keeps the tail.
    private readonly decoder = new TextDecoder('utf-8', { fatal: false });

    constructor(options: SessionOptions) {
        this.id = options.id;
        this.cwd = options.cwd;
        this.cols = options.cols;
        this.rows = options.rows;
        this.createdAt = Date.now();
        this.deliver = options.deliver;
        this.onExit = options.onExit;
        this.hookToken = options.hookToken;
        this.agent = options.restoredAgent ? { ...options.restoredAgent, live: false } : null;

        this.terminal = new Terminal({ cols: options.cols, rows: options.rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
        this.serializer = new SerializeAddon();
        this.terminal.loadAddon(this.serializer);
        if (options.restoredScreen !== undefined) {
            this.terminal.write(options.restoredScreen + RESTORED_MARKER);
        }
        if (options.motd) {
            // Written to the screen only, never to the PTY: the shell has not read a byte yet and must not.
            this.terminal.write(`\x1b[2m${options.motd}\x1b[0m\r\n`);
        }

        this.pty = options.adapter.spawn({
            shell: options.shell,
            args: options.args,
            cwd: options.cwd,
            cols: options.cols,
            rows: options.rows,
            env: options.env
        });
        this.pid = this.pty.pid;
        this.pty.onData((bytes) => this.receive(bytes));
        this.pty.onExit((exitCode) => this.handleExit(exitCode));
        if (options.command) {
            // The line waits in the tty until the shell reads input, however long its profile takes.
            this.pty.write(`${options.command}\n`);
        }
    }

    get exited(): boolean {
        return this.exitCode !== null;
    }

    get attachedCount(): number {
        return this.pending.size;
    }

    isAttached(clientId: string): boolean {
        return this.pending.has(clientId);
    }

    attachedClients(): string[] {
        return [...this.pending.keys()];
    }

    // Resolves once the emulator has parsed everything fed so far, so the screen a client
    // receives on attach never lags the bytes it will be streamed next.
    async serializeScreen(): Promise<string> {
        await new Promise<void>((resolve) => this.terminal.write('', resolve));
        return this.serializer.serialize({ scrollback: SCROLLBACK_LINES });
    }

    /* The screen and scrollback as text, for an agent that was linked to this session. */
    async plainText(): Promise<string> {
        await new Promise<void>((resolve) => this.terminal.write('', resolve));
        const buffer = this.terminal.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buffer.length; i++) {
            lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
        }
        while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines.join('\n');
    }

    async attach(clientId: string, cols: number, rows: number): Promise<string> {
        this.resize(cols, rows);
        const screen = await this.serializeScreen();
        // Registering after the serialize resolved (no await in between) is what keeps the screen
        // and the stream contiguous: nothing can land in both.
        if (!this.pending.has(clientId)) {
            this.pending.set(clientId, '');
        }
        return screen;
    }

    detach(clientId: string): void {
        const buffered = this.pending.get(clientId);
        if (buffered === undefined) {
            return;
        }
        this.pending.delete(clientId);
        if (buffered !== '') {
            this.deliver(clientId, buffered);
        }
    }

    write(data: string): void {
        this.pty.write(data);
    }

    resize(cols: number, rows: number): void {
        if (cols === this.cols && rows === this.rows) {
            return;
        }
        this.cols = cols;
        this.rows = rows;
        this.terminal.resize(cols, rows);
        if (!this.exited) {
            this.pty.resize(cols, rows);
        }
    }

    kill(): void {
        this.flush();
        if (this.exited) {
            return;
        }
        this.pty.kill('SIGHUP');
        if (this.killTimer === null) {
            this.killTimer = setTimeout(() => {
                this.killTimer = null;
                if (!this.exited) {
                    this.pty.kill('SIGKILL');
                }
            }, KILL_ESCALATION_MS);
        }
    }

    dispose(): void {
        this.clearTimers();
        this.pending.clear();
        this.terminal.dispose();
    }

    private clearTimers(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.killTimer !== null) {
            clearTimeout(this.killTimer);
            this.killTimer = null;
        }
    }

    flush(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        for (const [clientId, buffered] of this.pending) {
            if (buffered === '') {
                continue;
            }
            this.pending.set(clientId, '');
            this.deliver(clientId, buffered);
        }
    }

    private receive(bytes: Uint8Array): void {
        const text = this.decoder.decode(bytes, { stream: true });
        if (text === '') {
            return;
        }
        this.terminal.write(text);
        for (const [clientId, buffered] of this.pending) {
            this.pending.set(clientId, buffered + text);
        }
        if (this.flushTimer === null && this.pending.size > 0) {
            this.flushTimer = setTimeout(() => this.flush(), OUTPUT_TICK_MS);
        }
    }

    private handleExit(exitCode: number): void {
        if (this.exited) {
            return;
        }
        this.exitCode = exitCode;
        this.clearTimers();
        this.flush();
        this.onExit(exitCode);
    }
}
