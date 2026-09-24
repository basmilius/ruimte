import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Timers } from './approvals.ts';
import { ComputerUse, type ComputerUseOptions } from './computer-use.ts';
import { ComputerHelper, HelperUnreachable, type HelperTransport } from './helper.ts';
import type { HelperRequest, HelperSession, RunningApp } from './helper-protocol.ts';
import { ComputerUseStore } from './store.ts';
import type { ProcessRow } from './terminal-apps.ts';

/* Timers that only move when a test says so, with the clock the approvals read beside them. */
export class ManualTimers implements Timers {
    now = 1_000;
    private entries: { at: number; ms: number; run: () => void }[] = [];

    set(run: () => void, ms: number): () => void {
        const entry = { at: this.now + ms, ms, run };
        this.entries.push(entry);
        return () => {
            this.entries = this.entries.filter((candidate) => candidate !== entry);
        };
    }

    get waiting(): number {
        return this.entries.length;
    }

    /* The timers set for this long, apart from the others that run meanwhile. */
    waitingFor(ms: number): number {
        return this.entries.filter((entry) => entry.ms === ms).length;
    }

    advance(ms: number): void {
        this.now += ms;
        const due = this.entries.filter((entry) => entry.at <= this.now).sort((a, b) => a.at - b.at);
        this.entries = this.entries.filter((entry) => entry.at > this.now);
        for (const entry of due) {
            entry.run();
        }
    }
}

export const TEXT_EDIT: RunningApp = { name: 'TextEdit', pid: 501, bundleId: 'com.example.textedit', frontmost: true };
export const SHELL_APP: RunningApp = { name: 'Shells', pid: 777, bundleId: 'com.example.shells' };

export const SAMPLE_STATE = {
    app: { name: 'TextEdit', pid: 501, bundleId: 'com.example.textedit' },
    window: { title: 'Untitled', frame: { x: 292, y: 161, width: 586, height: 488 } },
    screenshot: { path: '/home/computer-use/screenshots/shot.png', width: 1172, height: 976, scale: 2, origin: { x: 292, y: 161 } },
    elements: 2,
    tree: ['[0] Window:StandardWindow "Untitled" (292,161 586x488)', '  [1] TextArea value="hi" (292,261 586x382) focused']
};

const HELD_REFUSALS = {
    paused: { ok: false, error: 'the person paused the session; wait until they resume', code: 'paused' },
    takenOver: { ok: false, error: 'the person took over; wait until they resume', code: 'taken-over' }
} as const;

const STOPPED_REFUSAL = { ok: false, error: 'stopped by the person (⌥⎋ or the stop button). Run `cu state <app>` to continue.', code: 'stopped' };

/* The helper app as a socket that answers from a script, its session kept the way the helper keeps it; it records every request it got. */
export class FakeHelper implements HelperTransport {
    running = true;
    readonly requests: HelperRequest[] = [];
    apps: RunningApp[] = [TEXT_EDIT, SHELL_APP];
    accessibility = true;
    screenRecording = true;
    error: string | null = null;
    session: HelperSession = { active: false, mode: 'running', stopped: false };
    shown: string | null = null;
    // Runs as an app command arrives, before the helper looks at its session: the person's hand in between.
    onAct: (() => void) | null = null;
    // An app that does not run until `open` names its bundle id, which then answers with it.
    launchable: RunningApp | null = null;
    // How many requests a helper told to quit still answers, the way the real one does for a moment.
    lingerAfterQuit = 0;
    // What a state answers, and a state after an action or a wait: change it to have the window change.
    state: typeof SAMPLE_STATE & Record<string, unknown> = SAMPLE_STATE;
    // The value `read` answers for an element.
    readValue = 'hi';
    // Whether a `wait` saw its condition hold before its timeout.
    waitMet = true;
    private lingering: number | null = null;

    async send(request: HelperRequest): Promise<unknown> {
        if (this.lingering !== null) {
            if (this.lingering === 0) {
                this.running = false;
                this.lingering = null;
            } else {
                this.lingering -= 1;
            }
        }
        if (!this.running) {
            throw new HelperUnreachable('connect ENOENT');
        }
        this.requests.push(request);
        if (request.command === 'quit') {
            if (this.lingerAfterQuit === 0) {
                this.running = false;
            } else {
                this.lingering = this.lingerAfterQuit;
            }
            // A fresh launch reads the grants anew; this one keeps what it had.
            return { ok: true, result: { stopped: true } };
        }
        if (request.command === 'pause' || request.command === 'resume' || request.command === 'stop') {
            this.press(request.command);
            return { ok: true, result: { session: this.session } };
        }
        if (request.command === 'clear-stop') {
            this.session = { ...this.session, stopped: false };
            return { ok: true, result: { session: this.session } };
        }
        if (request.command === 'doctor') {
            return {
                ok: true,
                result: {
                    accessibility: { granted: this.accessibility },
                    screenRecording: { granted: this.screenRecording },
                    ready: this.accessibility && this.screenRecording,
                    session: this.session
                }
            };
        }
        if (request.command === 'apps') {
            return { ok: true, result: { apps: this.apps } };
        }
        if (request.command === 'presence') {
            return this.presence(request);
        }
        this.onAct?.();
        if (request.command === 'state') {
            this.session = { ...this.session, stopped: false };
        }
        if (this.session.stopped) {
            return STOPPED_REFUSAL;
        }
        if (this.session.active && this.session.mode !== 'running') {
            return HELD_REFUSALS[this.session.mode];
        }
        this.session = { ...this.session, active: true };
        if (this.error !== null) {
            return { ok: false, error: this.error };
        }
        if (request.command === 'state') {
            return { ok: true, result: this.state };
        }
        if (request.command === 'read') {
            return {
                ok: true,
                result: { app: SAMPLE_STATE.app, element: request.element, role: 'TextArea', value: this.readValue, frame: { x: 1, y: 2, width: 3, height: 4 } }
            };
        }
        if (request.command === 'wait') {
            const condition =
                request.text !== undefined
                    ? `"${request.text}" to appear`
                    : request.gone !== undefined
                      ? `"${request.gone}" to go`
                      : `element ${request.element} to have the value "${request.value}"`;
            return {
                ok: true,
                result: { app: SAMPLE_STATE.app, met: this.waitMet, condition, waited: this.waitMet ? 1.5 : (request.timeout ?? 0), state: this.state }
            };
        }
        const launched = request.command === 'open' && this.launchable?.bundleId === request.app ? this.launchable : null;
        if (launched !== null) {
            this.apps = [...this.apps, launched];
        }
        return {
            ok: true,
            result: {
                app: launched === null ? SAMPLE_STATE.app : { name: launched.name, pid: launched.pid, bundleId: launched.bundleId },
                method: 'AXPress',
                target: { role: 'Button', label: 'Save', window: 'Untitled' },
                point: { x: 400, y: 300 },
                ...(request.withState ? { settled: true, state: this.state } : {})
            }
        };
    }

    /* The requests that acted on an app, leaving out the doctor and apps calls every action makes first. */
    get acted(): HelperRequest[] {
        return this.requests.filter((request) => !['doctor', 'apps', 'quit', 'presence', 'pause', 'resume', 'stop', 'clear-stop'].includes(request.command));
    }

    /* What the daemon showed at the cursor, as `state` or `state: label`. */
    get presences(): string[] {
        return this.requests
            .filter((request) => request.command === 'presence')
            .map((request) => (request.label === undefined ? `${request.state}` : `${request.state}: ${request.label}`));
    }

    /* The person's own hand: pausing, taking over or stopping from the bar, the menu or a key. */
    hold(mode: 'paused' | 'takenOver' | 'running'): void {
        this.session = { ...this.session, active: true, mode };
    }

    stop(): void {
        this.session = { active: false, mode: 'running', stopped: true };
    }

    /* What the buttons of the session bar do: nothing without a session, and a pause while paused is no resume. */
    private press(action: 'pause' | 'resume' | 'stop'): void {
        if (!this.session.active) {
            return;
        }
        if (action === 'stop') {
            this.stop();
        } else if (action === 'pause' && this.session.mode === 'running') {
            this.hold('paused');
        } else if (action === 'resume' && this.session.mode !== 'running') {
            this.hold('running');
        }
    }

    private presence(request: HelperRequest): unknown {
        const settles = request.state === 'done' || request.state === 'end' || request.ends === true;
        if (this.session.stopped && !settles) {
            return STOPPED_REFUSAL;
        }
        if (!this.session.active && settles) {
            return { ok: true, result: { session: false, shown: null } };
        }
        if (request.state === 'end') {
            this.shown = null;
            this.session = { active: false, mode: 'running', stopped: false };
            return { ok: true, result: { session: false, shown: null } };
        }
        const { mode } = this.session;
        this.shown = request.state ?? null;
        // The real helper ends the session once `done`, or a state that ends, has faded.
        this.session = settles ? { active: false, mode: 'running', stopped: false } : { ...this.session, active: true };
        return { ok: true, result: { session: true, shown: mode === 'running' ? request.state : mode === 'paused' ? 'paused' : 'takeover', mode } };
    }
}

/* A shell under the app with pid 777, on a pty of its own: what a terminal looks like in the process table. */
export const PROCESSES: ProcessRow[] = [
    { pid: 501, ppid: 1, tty: null },
    { pid: 777, ppid: 1, tty: null },
    { pid: 778, ppid: 777, tty: 'ttys004' }
];

export interface ComputerSetup {
    home: string;
    helper: FakeHelper;
    timers: ManualTimers;
    computer: ComputerUse;
    runs: Map<string, string>;
    launches: string[];
}

export const tempHome = async (): Promise<string> => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-computer-'));
    await writeFile(join(home, 'local.key'), 'secret\n');
    return home;
};

/* A computer use service over a fake helper, a fixed process table and manual timers; `enabled` turns it on first. */
export const computerSetup = async (
    options: { home?: string; enabled?: boolean; helper?: FakeHelper; overrides?: Partial<ComputerUseOptions> } = {}
): Promise<ComputerSetup> => {
    const home = options.home ?? (await tempHome());
    const helper = options.helper ?? new FakeHelper();
    const timers = new ManualTimers();
    const runs = new Map<string, string>([
        ['chat-1', 'chat:a'],
        ['term-1', 'terminal:b']
    ]);
    const launches: string[] = [];
    const store = new ComputerUseStore(home, () => timers.now);
    await store.load();
    const computer = new ComputerUse({
        home,
        store,
        helper: new ComputerHelper({
            home,
            appPath: '/Applications/Ruimte Computer Use.app',
            transport: helper,
            launch: async (appPath) => {
                launches.push(appPath);
                helper.running = true;
            },
            // Read from memory, so the path of a call holds no file I/O and `until` needs no clock.
            secret: async () => 'secret',
            sleep: async () => undefined
        }),
        runOf: (id) => runs.get(id) ?? null,
        describe: async (id) => ({ surface: id.startsWith('term') ? 'terminal' : 'chat', nodeTitle: `Node ${id}`, projectId: 'p1', projectName: 'Ruimte' }),
        processes: async () => PROCESSES,
        findApp: async (name) => (name === 'Notes' ? { name: 'Notes', bundleId: 'com.example.notes' } : null),
        now: () => timers.now,
        timers,
        ...options.overrides
    });
    if (options.enabled !== false) {
        await computer.setEnabled(true, 'en');
    }
    return { home, helper, timers, computer, runs, launches };
};

/* Lets the promise chains of the service run without a clock: every turn of the event loop, until the condition holds. */
export const until = async (condition: () => boolean): Promise<void> => {
    for (let i = 0; i < 1000 && !condition(); i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (!condition()) {
        throw new Error('the condition never held');
    }
};
