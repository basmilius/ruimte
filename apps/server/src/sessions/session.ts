import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import type { AgentInfo, AgentLaunch, RuntimeMode } from '@ruimte/contracts';
import type { PtyAdapter, PtyProcess } from '../pty/pty.ts';

const SCROLLBACK_LINES = 10_000;

// Roughly one animation frame: enough to fold a burst of small PTY reads into one frame on the
// wire without adding a delay anyone can see.
const OUTPUT_TICK_MS = 16;

// A shell that traps SIGHUP would otherwise keep a killed session alive forever.
const KILL_ESCALATION_MS = 2000;

/*
 * A line typed before the shell reads input sits in the tty's canonical queue, which macOS caps at
 * `MAX_CANON` (1024 bytes) and silently cuts, newline included. A longer line goes through the
 * shell's environment instead, so what is typed stays short whatever the note or first prompt holds.
 */
const MAX_TYPED_LINE = 1000;
export const START_LINE_ENV = 'RUIMTE_START_LINE';

export const RESTORED_TEXT = '[session restored, previous shell ended]';
const RESTORED_MARKER = `\r\n\x1b[2m${RESTORED_TEXT}\x1b[0m\r\n`;

/* What Ruimte itself puts on a screen, line by line, so it never reads as output of the shell. */
const dimmed = (text: string): string =>
    text
        .split('\n')
        .map((line) => `\x1b[2m${line}\x1b[0m\r\n`)
        .join('');

interface SessionOptions {
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
    // The CLI this session was opened for, kept so a resume that cannot work can still launch it.
    launch?: AgentLaunch;
    // First line typed into the shell, so a node can open straight into a program.
    command?: string;
    // Shown dimmed above the first prompt, for what the shell cannot tell on its own (the linked context).
    motd?: string;
    hookToken: string;
    deliver(clientId: string, data: string): void;
    onExit(exitCode: number): void;
}

interface ClientStream {
    // Output not sent yet; while a snapshot is on its way, the output that follows its screen.
    buffered: string;
    snapshot: PendingSnapshot | null;
}

interface PendingSnapshot {
    // The screen is taken at the last marker, so every caller gets one that holds what came before its own call.
    markers: number;
    waiters: Array<(screen: string) => void>;
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
    readonly launch: AgentLaunch | null;
    agent: AgentInfo | null;
    // The permission mode the CLI's hooks last reported, which outranks the launch: a person can switch it in the TUI.
    reportedMode: RuntimeMode | null = null;
    // A command from a project file the shell started without, until a person on this machine says yes to it.
    heldCommand: string | null = null;
    private readonly terminal: Terminal;
    private readonly serializer: SerializeAddon;
    private readonly pty: PtyProcess;
    private readonly deliver: (clientId: string, data: string) => void;
    private readonly onExit: (exitCode: number) => void;
    private readonly clients = new Map<string, ClientStream>();
    // The grid each client last fitted its node to; the PTY takes the one of the client active last.
    private readonly claims = new Map<string, { cols: number; rows: number }>();
    // A disposed terminal never calls back, so `dispose` runs whatever still waits on the parser itself.
    private readonly parsedWaiters = new Set<() => void>();
    // Whether the screen moved since the snapshot file last took it; a new session has never been taken.
    private dirty = true;
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
        this.launch = options.launch ?? null;
        this.agent = options.restoredAgent ? { ...options.restoredAgent, live: false } : null;

        this.terminal = new Terminal({ cols: options.cols, rows: options.rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
        this.serializer = new SerializeAddon();
        this.terminal.loadAddon(this.serializer);
        if (options.restoredScreen !== undefined) {
            this.terminal.write(options.restoredScreen + RESTORED_MARKER);
        }
        if (options.motd) {
            // Written to the screen only, never to the PTY: the shell has not read a byte yet and must not.
            this.terminal.write(dimmed(options.motd));
        }

        const command = options.command;
        const long = command !== undefined && Buffer.byteLength(command) > MAX_TYPED_LINE;
        this.pty = options.adapter.spawn({
            shell: options.shell,
            args: options.args,
            cwd: options.cwd,
            cols: options.cols,
            rows: options.rows,
            env: long ? { ...options.env, [START_LINE_ENV]: command } : options.env
        });
        this.pid = this.pty.pid;
        this.pty.onData((bytes) => this.receive(bytes));
        this.pty.onExit((exitCode) => this.handleExit(exitCode));
        if (command) {
            // The line waits in the tty until the shell reads input, however long its profile takes.
            this.pty.write(long ? `eval "$${START_LINE_ENV}"\n` : `${command}\n`);
        }
    }

    get exited(): boolean {
        return this.exitCode !== null;
    }

    get attachedCount(): number {
        return this.clients.size;
    }

    isAttached(clientId: string): boolean {
        return this.clients.has(clientId);
    }

    attachedClients(): string[] {
        return [...this.clients.keys()];
    }

    /* The screen once the emulator has parsed everything fed so far. A screen for a client comes from `snapshotFor` only. */
    serializeScreen(): Promise<string> {
        return new Promise((resolve) => this.whenParsed(() => resolve(this.serialize())));
    }

    /* The screen for the snapshot file, or null when nothing changed since the last one was taken. */
    changedScreen(): Promise<string> | null {
        if (!this.dirty) {
            return null;
        }
        this.dirty = false;
        return this.serializeScreen();
    }

    /* A screen that was taken but never reached the disk, so the next pass takes it again. */
    markChanged(): void {
        this.dirty = true;
    }

    /* The screen and scrollback as text, for an agent that was linked to this session. */
    async plainText(): Promise<string> {
        await new Promise<void>((resolve) => this.whenParsed(resolve));
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

    /*
     * A screen for one client and the stream that continues it, as one step. From this call on the
     * client's output is held, and what it had buffered is dropped, since the screen holds it. The
     * screen is taken in the marker's callback, where every byte fed before the marker is parsed and
     * none after it, and `onScreen` runs there, before the held output flows.
     */
    snapshotFor(clientId: string, onScreen: (screen: string) => void): void {
        let stream = this.clients.get(clientId);
        if (!stream) {
            stream = { buffered: '', snapshot: null };
            this.clients.set(clientId, stream);
        }
        stream.buffered = '';
        const snapshot = stream.snapshot ?? { markers: 0, waiters: [] };
        stream.snapshot = snapshot;
        snapshot.markers += 1;
        snapshot.waiters.push(onScreen);
        const owner = stream;
        this.whenParsed(() => {
            snapshot.markers -= 1;
            if (snapshot.markers > 0) {
                return;
            }
            const screen = this.serialize();
            owner.snapshot = null;
            for (const waiter of snapshot.waiters) {
                waiter(screen);
            }
            if (owner.buffered !== '' && this.clients.get(clientId) === owner) {
                this.scheduleFlush();
            }
        });
    }

    attach(clientId: string, cols?: number, rows?: number): Promise<string> {
        if (cols !== undefined && rows !== undefined) {
            this.claims.set(clientId, { cols, rows });
            this.resize(cols, rows);
        }
        return new Promise((resolve) => this.snapshotFor(clientId, resolve));
    }

    detach(clientId: string): void {
        const stream = this.clients.get(clientId);
        if (!stream) {
            return;
        }
        this.clients.delete(clientId);
        this.claims.delete(clientId);
        // Output held for a snapshot belongs after a screen this client is no longer streamed from.
        if (stream.snapshot === null && stream.buffered !== '') {
            this.deliver(clientId, stream.buffered);
        }
    }

    write(data: string): void {
        this.pty.write(data);
    }

    /*
     * A line from Ruimte on a screen that is already running: a message another node left for this
     * one. Written to the emulator and to whoever is watching, never into the PTY, since the shell
     * must not read a byte nobody typed. It starts on a line of its own, because a prompt is
     * usually half drawn where this lands.
     */
    notice(text: string): void {
        this.append(`\r\n${dimmed(text)}`);
    }

    /*
     * What Terminal.app's Clear does: the buffer goes, the prompt line becomes the first, and the
     * shell is never told. Output waiting for its tick goes out first; every client then gets the
     * fresh screen through `resync`, and what arrives meanwhile is in that screen or follows it.
     */
    clear(resync: (clientId: string, screen: string) => void): Promise<void> {
        this.flush();
        this.dirty = true;
        return new Promise((resolve) => {
            this.whenParsed(() => {
                this.terminal.clear();
                const clientIds = this.attachedClients();
                let open = clientIds.length;
                if (open === 0) {
                    resolve();
                    return;
                }
                for (const clientId of clientIds) {
                    this.snapshotFor(clientId, (screen) => {
                        resync(clientId, screen);
                        open -= 1;
                        if (open === 0) {
                            resolve();
                        }
                    });
                }
            });
        });
    }

    /* A client's fit. A new grid is that client at work and sizes the PTY; a refit to the grid it had is not. */
    claim(clientId: string, cols: number, rows: number): void {
        const previous = this.claims.get(clientId);
        this.claims.set(clientId, { cols, rows });
        if (previous?.cols !== cols || previous.rows !== rows) {
            this.resize(cols, rows);
        }
    }

    /* A keystroke hands the PTY to the client it came from, at the grid that client fits; a follower claims none. */
    activate(clientId: string): void {
        const claim = this.claims.get(clientId);
        if (claim) {
            this.resize(claim.cols, claim.rows);
        }
    }

    resize(cols: number, rows: number): void {
        if (cols === this.cols && rows === this.rows) {
            return;
        }
        this.cols = cols;
        this.rows = rows;
        this.dirty = true;
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
        this.clients.clear();
        for (const run of [...this.parsedWaiters]) {
            run();
        }
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
        for (const [clientId, stream] of this.clients) {
            if (stream.snapshot !== null || stream.buffered === '') {
                continue;
            }
            const data = stream.buffered;
            stream.buffered = '';
            this.deliver(clientId, data);
        }
    }

    private serialize(): string {
        return this.serializer.serialize({ scrollback: SCROLLBACK_LINES });
    }

    // xterm calls back in the middle of its write loop: every earlier write is parsed there, no later one is.
    private whenParsed(callback: () => void): void {
        const run = (): void => {
            if (this.parsedWaiters.delete(run)) {
                callback();
            }
        };
        this.parsedWaiters.add(run);
        this.terminal.write('', run);
    }

    private scheduleFlush(): void {
        if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => this.flush(), OUTPUT_TICK_MS);
        }
    }

    private append(text: string): void {
        this.dirty = true;
        this.terminal.write(text);
        for (const stream of this.clients.values()) {
            stream.buffered += text;
        }
        if (this.clients.size > 0) {
            this.scheduleFlush();
        }
    }

    private receive(bytes: Uint8Array): void {
        const text = this.decoder.decode(bytes, { stream: true });
        if (text !== '') {
            this.append(text);
        }
    }

    private handleExit(exitCode: number): void {
        if (this.exited) {
            return;
        }
        this.exitCode = exitCode;
        this.dirty = true;
        this.clearTimers();
        this.flush();
        this.onExit(exitCode);
    }
}
