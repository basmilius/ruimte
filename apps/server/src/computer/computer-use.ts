import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ComputerApproval, ComputerApprovalChoice, ComputerUseStatus } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { CodedError } from '../coded-error.ts';
import { writeAtomic } from '../fs.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { APPROVAL_WAIT_MS, ComputerApprovals, realTimers, type AppRef, type CallerInfo, type Timers } from './approvals.ts';
import { HelperFailure, helperDirectory, type ComputerHelper } from './helper.ts';
import {
    ActionResultSchema,
    AppsResultSchema,
    DoctorResultSchema,
    PresenceResultSchema,
    StateResultSchema,
    type ActionResult,
    type AppCommand,
    type DoctorResult,
    type HelperRequest,
    type HelperSession,
    type RunningApp,
    type StateResult
} from './helper-protocol.ts';
import { overlayWords, presenceWords } from './overlay-words.ts';
import { ComputerPresence, type PresenceShow } from './presence.ts';
import type { ComputerUseStore } from './store.ts';
import { readProcessTable, runsShells, type ProcessRow, type ProcessTable } from './terminal-apps.ts';

/* A no to an agent: the code a script branches on, the sentence the model reads, what it may pick instead. */
export class ComputerRefusal extends CodedError {}

/* How often a call held by the person's pause asks the helper whether they resumed. */
const HOLD_POLL_MS = 500;

type HeldCode = 'paused' | 'taken-over';

/* The person holds the Mac. Nothing the agent does changes that, so the words steer it away from trying. */
const HELD_WORDS: Record<HeldCode, string> = {
    paused: 'The person paused the session; wait until they resume it, then read the state and call again. Do not try to reach the app another way meanwhile',
    'taken-over':
        'The person took over the Mac; wait until they hand it back, then read the state and call again. Do not try to reach the app another way meanwhile'
};

const STOPPED_WORDS = 'The person stopped you; ask them before you operate an app again, and once they agree start with computer state';

/* Where the helper looks for an app by name; the same folders, so a name the daemon finds is the app the helper opens. */
const applicationFolders = (): string[] => [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    join(homedir(), 'Applications')
];

const plistValue = async (plist: string, key: string): Promise<string | null> => {
    const child = Bun.spawn(['plutil', '-extract', key, 'raw', '-o', '-', plist], { stdout: 'pipe', stderr: 'ignore' });
    const text = (await new Response(child.stdout).text()).trim();
    return (await child.exited) === 0 && text !== '' ? text : null;
};

/* An app that does not run yet, by the file name of its bundle, for `open`. */
export const findInstalledApp = async (name: string): Promise<AppRef | null> => {
    const wanted = name.toLowerCase().replace(/\.app$/, '');
    for (const folder of applicationFolders()) {
        const entries = await readdir(folder).catch(() => [] as string[]);
        const match = entries.find((entry) => entry.toLowerCase() === `${wanted}.app`);
        if (match === undefined) {
            continue;
        }
        const bundleId = await plistValue(join(folder, match, 'Contents', 'Info.plist'), 'CFBundleIdentifier');
        if (bundleId !== null) {
            return { name: match.replace(/\.app$/i, ''), bundleId };
        }
    }
    return null;
};

export type AppAccess = 'always' | 'this-time' | 'ask' | 'terminal' | 'no-bundle-id';

export interface ListedApp {
    app: RunningApp;
    access: AppAccess;
}

export interface AppsOutcome {
    apps: ListedApp[];
    doctor: DoctorResult;
}

export type Resolved = { kind: 'running'; app: RunningApp } | { kind: 'ambiguous'; matches: RunningApp[] } | { kind: 'none' };

/* The app a query names, the way the helper reads one: a pid, a bundle id, or a name with or without `.app`. */
export const resolveApp = (query: string, apps: readonly RunningApp[]): Resolved => {
    const wanted = query.trim().toLowerCase();
    if (/^\d+$/.test(wanted)) {
        const byPid = apps.find((app) => app.pid === Number(wanted));
        return byPid ? { kind: 'running', app: byPid } : { kind: 'none' };
    }
    const byBundle = apps.find((app) => app.bundleId?.toLowerCase() === wanted);
    if (byBundle) {
        return { kind: 'running', app: byBundle };
    }
    const bare = wanted.replace(/\.app$/, '');
    const byName = apps.filter((app) => app.name.toLowerCase() === bare);
    if (byName.length > 1) {
        return { kind: 'ambiguous', matches: byName };
    }
    return byName.length === 1 ? { kind: 'running', app: byName[0]! } : { kind: 'none' };
};

const appLine = (app: RunningApp): string => `app\t${app.name}\t${app.bundleId ?? '-'}\t${app.pid}`;

const APPS_SEE = 'see\truimte-context computer apps\tevery app that runs, with its bundle id and pid';

/*
 * The helper words its errors for `cu`, its own command line; an agent runs this CLI instead, and a
 * missing grant is a person's to give.
 */
export const agentWords = (message: string): string =>
    message
        .replace(/run `cu doctor`/g, 'a person grants it to Ruimte Computer Use in System Settings')
        .replace(/`cu ([a-z-]+)/g, '`ruimte-context computer $1');

export interface ComputerUseOptions {
    home: string;
    store: ComputerUseStore;
    helper: ComputerHelper;
    /* The run a chat or terminal is on now, or null when none runs under that id. */
    runOf: (callerId: string) => string | null;
    describe: (callerId: string) => Promise<CallerInfo>;
    processes?: ProcessTable;
    findApp?: (name: string) => Promise<AppRef | null>;
    now?: () => number;
    timers?: Timers;
    waitMs?: number;
    log?: (message: string) => void;
}

/* The fields of a helper request an agent's call fills, besides the command and the app. */
export type OperateInput = Omit<HelperRequest, 'command' | 'app' | 'secret' | 'prompt' | 'state' | 'label' | 'step'>;

/*
 * Computer use on this machine: the setting, the helper app, and the rules an agent's call passes
 * before the helper acts. Off, nothing starts the helper. On, every call that reads or operates an
 * app needs a person's yes for that app, in every permission mode, and a terminal is never one.
 */
export class ComputerUse {
    readonly approvals: ComputerApprovals;
    private readonly home: string;
    private readonly store: ComputerUseStore;
    private readonly helper: ComputerHelper;
    private readonly runOf: (callerId: string) => string | null;
    private readonly describe: (callerId: string) => Promise<CallerInfo>;
    private readonly processes: ProcessTable;
    private readonly findApp: (name: string) => Promise<AppRef | null>;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly waitMs: number;
    private readonly sinks = new ClientSinks();
    private readonly presence: ComputerPresence;
    // The helper's session as last heard: from doctor, a presence reply or a refusal. Null while the helper does not run.
    private session: HelperSession | null = null;
    private current: ComputerUseStatus;

    constructor(options: ComputerUseOptions) {
        this.home = options.home;
        this.store = options.store;
        this.helper = options.helper;
        this.runOf = options.runOf;
        this.describe = options.describe;
        this.processes = options.processes ?? readProcessTable;
        this.findApp = options.findApp ?? findInstalledApp;
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.waitMs = options.waitMs ?? APPROVAL_WAIT_MS;
        this.current = { enabled: options.store.enabled, present: options.helper.present, running: false, accessibility: null, screenRecording: null };
        this.presence = new ComputerPresence({
            send: (show) => this.showPresence(show),
            words: () => presenceWords(this.store.language),
            alive: (nodeId) => this.runOf(nodeId) !== null,
            onHolder: () => this.setStatus(this.current),
            ...(options.log ? { log: options.log } : {})
        });
        this.approvals = new ComputerApprovals({
            grants: options.store,
            runOf: options.runOf,
            publish: (approvals) => {
                this.sinks.emit({ event: 'computer.approvals', payload: { approvals } });
                this.presence.approvals(approvals);
            },
            ...(options.now ? { now: options.now } : {}),
            ...(options.timers ? { timers: options.timers } : {}),
            ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {})
        });
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    get enabled(): boolean {
        return this.store.enabled;
    }

    status(): ComputerUseStatus {
        return this.current;
    }

    pendingApprovals(): ComputerApproval[] {
        return this.approvals.list();
    }

    answer(requestId: string, choice: ComputerApprovalChoice): Promise<boolean> {
        return this.approvals.answer(requestId, choice);
    }

    /* What the chats and terminals are doing, for the cursor of the agent that holds the session. */
    observe(event: SessionEvent): void {
        if (event.event === 'session.status') {
            if (event.payload.agent) {
                this.presence.status(event.payload.sessionId, event.payload.agent.status);
            }
        } else if (event.event === 'session.exit') {
            this.presence.closed(event.payload.sessionId);
        } else if (event.event === 'chat.event') {
            const { chatId, event: chat } = event.payload;
            if (chat.type === 'item' && chat.item.kind === 'turn' && chat.item.state !== 'running') {
                this.presence.turnEnded(chatId, chat.item.state === 'aborted');
            } else if (chat.type === 'info') {
                this.presence.status(chatId, chat.info.status);
            }
        }
    }

    /* A chat or terminal goes; a chat says nothing to an observer when it does. */
    nodeClosed(nodeId: string): void {
        this.presence.closed(nodeId);
    }

    /* Asks the helper how it stands. Only a machine with computer use on starts it for that. */
    async refreshStatus(): Promise<ComputerUseStatus> {
        const base = { enabled: this.store.enabled, present: this.helper.present };
        if (!this.helper.present) {
            return this.setStatus({ ...base, running: false, accessibility: null, screenRecording: null });
        }
        try {
            const doctor = this.store.enabled
                ? await this.helper.request({ command: 'doctor', prompt: false }, DoctorResultSchema)
                : await this.helper.ask({ command: 'doctor', prompt: false }, DoctorResultSchema);
            this.session = doctor?.session ?? null;
            return this.setStatus(
                doctor === null
                    ? { ...base, running: false, accessibility: null, screenRecording: null }
                    : { ...base, running: true, accessibility: doctor.accessibility.granted, screenRecording: doctor.screenRecording.granted }
            );
        } catch (error) {
            return this.setStatus({
                ...base,
                running: false,
                accessibility: null,
                screenRecording: null,
                problem: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async setEnabled(enabled: boolean, language: string | undefined): Promise<ComputerUseStatus> {
        await this.store.setEnabled(enabled, language);
        if (enabled) {
            await this.writeOverlay();
            return this.refreshStatus();
        }
        this.approvals.dropAll();
        this.presence.drop();
        await this.helper.quit();
        this.session = null;
        // Not asked again: the helper answers for a moment after it was told to quit.
        return this.setStatus({ ...this.current, enabled: false, running: false });
    }

    /* Writes the pill's words for a helper that is on; call once the store is loaded. */
    async start(): Promise<void> {
        if (this.store.enabled) {
            await this.writeOverlay();
        }
    }

    /* The daemon stops, and the helper with it: nobody is left to ask it anything. */
    async stop(): Promise<void> {
        await this.helper.quit();
    }

    /* Every app that runs, with how this caller stands with it. Asks nothing of a person. */
    async apps(callerId: string): Promise<AppsOutcome> {
        const doctor = await this.ready();
        const { apps } = await this.call(() => this.helper.request({ command: 'apps' }, AppsResultSchema));
        const rows = await this.processes();
        const run = this.runOf(callerId);
        const listed = await Promise.all(
            apps.map(async (app): Promise<ListedApp> => {
                if (app.bundleId === undefined) {
                    return { app, access: 'no-bundle-id' };
                }
                if (await this.isTerminal(app.bundleId, app.name, app.pid, rows)) {
                    return { app, access: 'terminal' };
                }
                return { app, access: run === null ? 'ask' : this.approvals.standing(callerId, run, app.bundleId) };
            })
        );
        return { apps: listed, doctor };
    }

    /* `state` answers with the tree and the picture; every other command with what it did. */
    async operate(callerId: string, command: 'state', query: string, input: OperateInput): Promise<StateResult>;
    async operate(callerId: string, command: Exclude<AppCommand, 'state'>, query: string, input: OperateInput): Promise<ActionResult>;
    async operate(callerId: string, command: AppCommand, query: string, input: OperateInput): Promise<StateResult | ActionResult> {
        this.presence.calling(callerId);
        try {
            return await this.operateNow(callerId, command, query, input);
        } finally {
            this.presence.acted(callerId);
        }
    }

    private async operateNow(callerId: string, command: AppCommand, query: string, input: OperateInput): Promise<StateResult | ActionResult> {
        // One budget for the card and the person's pause together, so a held call still ends inside the CLI's own limit.
        const deadline = this.now() + this.waitMs;
        await this.ready();
        const run = this.runOf(callerId);
        if (run === null) {
            throw new ComputerRefusal('not-in-session', 'Only an agent in a chat or a terminal that runs now operates an app');
        }
        const { app, pid } = await this.target(command, query);
        if (await this.isTerminal(app.bundleId, app.name, pid, pid === null ? [] : await this.processes())) {
            throw new ComputerRefusal(
                'terminal',
                `${app.name} runs shells, and an agent never operates a terminal, not even with a person's yes; run commands in your own shell instead`
            );
        }
        const outcome = await this.approvals.ask({ callerId, run, app, command, caller: await this.describe(callerId) });
        if (outcome === 'waiting') {
            throw new ComputerRefusal(
                'awaiting-approval',
                `A card asking the person to let you operate ${app.name} is up in Ruimte; tell them, and call again once they answered`
            );
        }
        if (outcome === 'declined') {
            throw new ComputerRefusal('declined', `The person did not let you operate ${app.name}; leave it alone unless they ask you to`);
        }
        await this.holdWhileHeld(deadline);
        const request: HelperRequest = { ...input, command, app: pid === null ? app.bundleId : String(pid) };
        const result = await this.act<StateResult | ActionResult>(callerId, app.name, deadline, () =>
            command === 'state' ? this.helper.request(request, StateResultSchema) : this.helper.request(request, ActionResultSchema)
        );
        if (command === 'open' && result.app?.bundleId !== undefined) {
            // A terminal that did not run until now is one from here on, even between its shells.
            await this.isTerminal(result.app.bundleId, result.app.name, result.app.pid, await this.processes());
        }
        return result;
    }

    private async target(command: AppCommand, query: string): Promise<{ app: AppRef; pid: number | null }> {
        const { apps } = await this.call(() => this.helper.request({ command: 'apps' }, AppsResultSchema));
        const resolved = resolveApp(query, apps);
        if (resolved.kind === 'ambiguous') {
            throw new ComputerRefusal('ambiguous-app', `More than one app that runs is called ${query}; name one by its pid`, resolved.matches.map(appLine));
        }
        if (resolved.kind === 'running') {
            const { app } = resolved;
            if (app.bundleId === undefined) {
                throw new ComputerRefusal('no-bundle-id', `${app.name} has no bundle id, and a person lets an agent into an app by its bundle id`);
            }
            return { app: { name: app.name, bundleId: app.bundleId }, pid: app.pid };
        }
        if (command !== 'open') {
            throw new ComputerRefusal('unknown-app', `No app that runs is called ${query}; open starts one`, [
                ...apps.map(appLine),
                'see\truimte-context computer open <app>\tstarts an app by the file name of its bundle or its bundle id'
            ]);
        }
        const installed =
            /^[\w-]+(\.[\w-]+)+$/.test(query) && !query.toLowerCase().endsWith('.app') ? { name: query, bundleId: query } : await this.findApp(query);
        if (installed === null) {
            throw new ComputerRefusal(
                'unknown-app',
                `No app called ${query} is in /Applications, /System/Applications or ~/Applications; name it by its bundle id`,
                [APPS_SEE]
            );
        }
        return { app: installed, pid: null };
    }

    /* Whether an app is a terminal: seen running shells once, or doing so now. One seen now is remembered. */
    private async isTerminal(bundleId: string, name: string, pid: number | null, rows: readonly ProcessRow[]): Promise<boolean> {
        if (this.store.knownTerminal(bundleId)) {
            return true;
        }
        if (pid === null || !runsShells(pid, rows)) {
            return false;
        }
        await this.store.rememberTerminal(bundleId, name);
        return true;
    }

    /* One call that reaches the helper for an app: it makes the caller the one the cursor speaks for. */
    private async act<Result>(callerId: string, appName: string, deadline: number, work: () => Promise<Result>): Promise<Result> {
        this.presence.acting(callerId);
        let result: Result;
        try {
            result = await this.call(work);
        } catch (error) {
            const code = error instanceof ComputerRefusal ? error.code : null;
            if (code === 'app-refused') {
                this.presence.failed(callerId, appName);
            }
            if (code === 'paused' || code === 'taken-over') {
                // Never sent again: the person may have cut it off halfway, so the agent reads the state first.
                await this.heldUntil(deadline);
            }
            throw error;
        }
        this.heard({ active: true, mode: 'running', stopped: false });
        return result;
    }

    /* Holds a call while the person has the Mac, for what is left of its budget, and refuses once that is spent. */
    private async holdWhileHeld(deadline: number): Promise<void> {
        const held = await this.heldUntil(deadline);
        if (held !== null) {
            throw new ComputerRefusal(held, HELD_WORDS[held]);
        }
    }

    /* How the person still holds the Mac at the deadline, or null once they gave it back; asks the helper again every so often. */
    private async heldUntil(deadline: number): Promise<HeldCode | null> {
        for (let held = this.heldCode(); held !== null; held = this.heldCode()) {
            const left = deadline - this.now();
            if (left <= 0) {
                return held;
            }
            await new Promise<void>((settle) => this.timers.set(settle, Math.min(HOLD_POLL_MS, left)));
            const doctor = await this.helper.ask({ command: 'doctor', prompt: false }, DoctorResultSchema).catch(() => null);
            this.heard(doctor?.session ?? null);
        }
        return null;
    }

    private heldCode(): HeldCode | null {
        if (this.session === null || !this.session.active) {
            return null;
        }
        return this.session.mode === 'paused' ? 'paused' : this.session.mode === 'takenOver' ? 'taken-over' : null;
    }

    private heard(session: HelperSession | null): void {
        this.session = session;
        this.setStatus(this.current);
    }

    private async showPresence(show: PresenceShow): Promise<void> {
        const request: HelperRequest = { command: 'presence', state: show.state, ...(show.label === undefined ? {} : { label: show.label }) };
        let reply;
        try {
            reply = await this.helper.ask(request, PresenceResultSchema);
        } catch (error) {
            if (error instanceof HelperFailure && error.helperCode === 'stopped') {
                this.heard({ active: false, mode: 'running', stopped: true });
                this.presence.drop();
            }
            throw error;
        }
        if (reply === null || !reply.session) {
            this.heard(reply === null ? null : { active: false, mode: 'running', stopped: false });
            return;
        }
        // The helper ends a session once `done` has faded, so it runs no more as far as anyone should show.
        this.heard({ active: show.state !== 'done', mode: reply.mode, stopped: false });
    }

    /* On, present and able to read another app; anything short of that is refused before an app is named. */
    private async ready(): Promise<DoctorResult> {
        if (!this.store.enabled) {
            throw new ComputerRefusal('computer-use-off', 'Computer use is off on this machine; only a person turns it on, in Ruimte');
        }
        const doctor = await this.call(() => this.helper.request({ command: 'doctor', prompt: false }, DoctorResultSchema));
        this.session = doctor.session ?? null;
        this.setStatus({
            enabled: true,
            present: true,
            running: true,
            accessibility: doctor.accessibility.granted,
            screenRecording: doctor.screenRecording.granted
        });
        if (!doctor.accessibility.granted) {
            throw new ComputerRefusal(
                'not-granted',
                'Ruimte Computer Use does not have the Accessibility permission yet; only a person grants it, in System Settings > Privacy & Security'
            );
        }
        return doctor;
    }

    /* A helper that said no, in words for the agent; one that could not be reached is the machine's failure. */
    private async call<Result>(work: () => Promise<Result>): Promise<Result> {
        try {
            return await work();
        } catch (error) {
            if (!(error instanceof HelperFailure) || error.code !== 'helper-error') {
                throw error;
            }
            if (error.helperCode === 'paused' || error.helperCode === 'taken-over') {
                this.heard({ active: true, mode: error.helperCode === 'paused' ? 'paused' : 'takenOver', stopped: false });
                throw new ComputerRefusal(error.helperCode, HELD_WORDS[error.helperCode]);
            }
            // A helper from before the codes worded a stop both ways.
            if (error.helperCode === 'stopped' || /^stopped by the (user|person)\b/.test(error.message)) {
                this.heard({ active: false, mode: 'running', stopped: true });
                this.presence.drop();
                throw new ComputerRefusal('stopped', STOPPED_WORDS);
            }
            throw new ComputerRefusal('app-refused', agentWords(error.message));
        }
    }

    private setStatus(status: ComputerUseStatus): ComputerUseStatus {
        const session = this.session;
        const next: ComputerUseStatus = {
            ...status,
            session: session !== null && session.active && status.running ? { mode: session.mode, nodeId: this.presence.holder } : null
        };
        if (JSON.stringify(next) !== JSON.stringify(this.current)) {
            this.current = next;
            this.sinks.emit({ event: 'computer.status', payload: next });
        }
        return this.current;
    }

    private async writeOverlay(): Promise<void> {
        const directory = helperDirectory(this.home);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeAtomic(join(directory, 'overlay.json'), `${JSON.stringify(overlayWords(this.store.language))}\n`, 0o600);
    }
}
