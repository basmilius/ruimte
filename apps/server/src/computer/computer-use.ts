import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
    ComputerAppGrants,
    ComputerApproval,
    ComputerApprovalChoice,
    ComputerControlAction,
    ComputerGrant,
    ComputerRevokeKind,
    ComputerUseStatus
} from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { CodedError } from '../coded-error.ts';
import { errorText } from '../error-text.ts';
import { writeAtomic } from '../fs.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { APPROVAL_WAIT_MS, ComputerApprovals, MAX_HOLD_MS, realTimers, type AppRef, type CallerInfo, type Timers } from './approvals.ts';
import { HelperFailure, helperDirectory, type ComputerHelper } from './helper.ts';
import {
    ActionResultSchema,
    AppsResultSchema,
    DoctorResultSchema,
    PresenceResultSchema,
    PressResultSchema,
    ReadResultSchema,
    StateResultSchema,
    WaitResultSchema,
    type ActionResult,
    type AppCommand,
    type DoctorResult,
    type HelperRequest,
    type HelperSession,
    type ReadResult,
    type RunningApp,
    type StateResult,
    type WaitResult
} from './helper-protocol.ts';
import { overlayWords, presenceWords } from './overlay-words.ts';
import { ComputerPresence, type LineOutcome, type PresenceShow } from './presence.ts';
import type { ComputerUseStore } from './store.ts';
import { readProcessTable, runsShells, type ProcessRow, type ProcessTable } from './terminal-apps.ts';
import { diffTree, rememberTree, type RememberedTree, type TreeView } from './tree-diff.ts';

/* A no to an agent: the code a script branches on, the sentence the model reads, what it may pick instead. */
export class ComputerRefusal extends CodedError {}

/* How often a call held by the person's pause asks the helper whether they resumed. */
const HOLD_POLL_MS = 500;

/* How often the machine asks how a running session stands, so a pause, a stop or the helper's own end shows without a call. */
export const SESSION_POLL_MS = 2_000;

/* The release and the dev build of the desktop app; either one is a window a person decides in. */
export const RUIMTE_BUNDLE_IDS: ReadonlySet<string> = new Set(['app.ruimte.desktop', 'app.ruimte.desktop.dev']);

/* How long Ruimte stays operated after the agent's actions moved to another app: the helper's own bound on letting a UI settle. */
export const RUIMTE_SETTLE_MS = 3_000;

type HeldCode = 'paused' | 'taken-over';

/* The person holds the Mac. Nothing the agent does changes that, so the words steer it away from trying. */
const HELD_WORDS: Record<HeldCode, string> = {
    paused: 'The person paused the session. Call computer state again with --wait 60, which holds until they resume, and act only after it: they may have changed the window. Do not try to reach the app another way meanwhile',
    'taken-over':
        'The person took over the Mac. Call computer state again with --wait 60, which holds until they hand it back, and act only after it: they may have changed the window. Do not try to reach the app another way meanwhile'
};

const STOPPED_WORDS = 'The person stopped you; ask them before you operate an app again, and once they agree start with computer state';

/* One agent operates the Mac at a time; the words name the one that does, by the title the person sees. */
const busyRefusal = (nodeTitle: string | null): ComputerRefusal =>
    new ComputerRefusal(
        'busy',
        `Another agent operates this Mac now${nodeTitle === null ? '' : `, from "${nodeTitle}"`}; call again with --wait 60, which holds until it is free, or go on with work that needs no app`
    );

const offRefusal = (): ComputerRefusal => new ComputerRefusal('computer-use-off', 'Computer use is off on this machine; only a person turns it on, in Ruimte');

const declinedRefusal = (name: string): ComputerRefusal =>
    new ComputerRefusal('declined', `The person did not let you operate ${name}; leave it alone unless they ask you to`);

const terminalRefusal = (name: string): ComputerRefusal =>
    new ComputerRefusal(
        'terminal',
        `${name} runs shells, and an agent never operates a terminal, not even with a person's yes; run commands in your own shell instead`
    );

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

const fileNameOf = (bundle: string): string => basename(bundle).replace(/\.app$/i, '');

export interface InstalledAppSources {
    folders?: string[];
    read?: (plist: string, key: string) => Promise<string | null>;
}

/*
 * An app that does not run yet, for `open`: by the file name of its bundle, or else by the name it
 * shows (`CFBundleDisplayName`), which differs for some apps. Only the second reads every bundle.
 */
export const findInstalledApp = async (name: string, sources: InstalledAppSources = {}): Promise<AppRef | null> => {
    const read = sources.read ?? plistValue;
    const wanted = name
        .trim()
        .toLowerCase()
        .replace(/\.app$/, '');
    const listed = await Promise.all(
        (sources.folders ?? applicationFolders()).map(async (folder) =>
            (await readdir(folder).catch(() => [] as string[])).filter((entry) => entry.toLowerCase().endsWith('.app')).map((entry) => join(folder, entry))
        )
    );
    const bundles = listed.flat();
    const infoOf = (bundle: string): string => join(bundle, 'Contents', 'Info.plist');
    let matches = bundles.filter((bundle) => fileNameOf(bundle).toLowerCase() === wanted);
    if (matches.length === 0) {
        const shown = await Promise.all(bundles.map((bundle) => read(infoOf(bundle), 'CFBundleDisplayName')));
        matches = bundles.filter((_bundle, i) => shown[i]?.toLowerCase() === wanted);
    }
    for (const bundle of matches) {
        const bundleId = await read(infoOf(bundle), 'CFBundleIdentifier');
        if (bundleId !== null) {
            return { name: fileNameOf(bundle), bundleId };
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

/*
 * The app a query names, the way the helper reads one: a pid, a bundle id, or a name with or without
 * `.app`. The name is the one it shows, which macOS localizes, or the file name of its bundle, which it does not.
 */
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
    const byName = apps.filter((app) => app.name.toLowerCase() === bare || app.bundleName?.toLowerCase() === bare);
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

type HelperAnswer = StateResult | ReadResult | WaitResult | ActionResult;

const ANSWER_SCHEMAS: Record<AppCommand, typeof StateResultSchema | typeof ReadResultSchema | typeof WaitResultSchema | typeof ActionResultSchema> = {
    state: StateResultSchema,
    read: ReadResultSchema,
    wait: WaitResultSchema,
    click: ActionResultSchema,
    scroll: ActionResultSchema,
    type: ActionResultSchema,
    key: ActionResultSchema,
    'set-value': ActionResultSchema,
    open: ActionResultSchema,
    menu: ActionResultSchema,
    drag: ActionResultSchema
};

/* The fields of a helper request an agent's call fills, besides the command and the app. */
export type OperateInput = Omit<HelperRequest, 'command' | 'app' | 'secret' | 'prompt' | 'state' | 'label' | 'step' | 'ends'>;

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
    private readonly log: (message: string) => void;
    private readonly sinks = new ClientSinks();
    private readonly presence: ComputerPresence;
    // The helper's session as last heard: from doctor, a presence reply or a refusal. Null while the helper does not run.
    private session: HelperSession | null = null;
    // Nodes whose agent made a call since computer use was turned on; a stop is told to each of them.
    private readonly callers = new Set<string>();
    // Nodes whose agent has not heard of the person's last stop yet.
    private readonly stopped = new Set<string>();
    // The helper forgetting the last stop; a call waits for it, or the helper would refuse it for that stop too.
    private clearing: Promise<void> = Promise.resolve();
    private cancelPoll: (() => void) | null = null;
    private current: ComputerUseStatus;
    private publishedGrants = '';
    // Whether an action of this session went to Ruimte, and since when its actions go elsewhere; both reset with the session.
    private ruimteTargeted = false;
    private awaySince: number | null = null;
    private ruimteActions = 0;
    private confirming: Promise<boolean> | null = null;
    // The last whole tree each agent got per app. Kept here, not in the helper: its one element map serves every agent, and only the daemon knows which agent got which tree.
    private readonly trees = new Map<string, RememberedTree>();

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
        this.log = options.log ?? console.warn;
        this.current = { enabled: options.store.enabled, present: options.helper.present, running: false, accessibility: null, screenRecording: null };
        this.presence = new ComputerPresence({
            send: (show) => this.showPresence(show),
            words: () => presenceWords(this.store.language),
            alive: (nodeId) => this.runOf(nodeId) !== null,
            onHolder: () => this.setStatus(this.current),
            onLine: () => this.setStatus(this.current),
            ...(options.log ? { log: options.log } : {})
        });
        this.approvals = new ComputerApprovals({
            grants: options.store,
            runOf: options.runOf,
            publish: (approvals) => {
                this.sinks.emit({ event: 'computer.approvals', payload: { approvals } });
                this.presence.approvals(approvals);
            },
            grantsChanged: () => this.publishGrants(),
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

    /* On, and with both grants as the helper last reported them: only then do agents hear of the noun. */
    get usable(): boolean {
        return this.store.enabled && this.current.accessibility === true && this.current.screenRecording === true;
    }

    status(): ComputerUseStatus {
        return this.current;
    }

    /* The chat or terminal whose agent holds the Mac: the first to take it, until its turn ends, its node goes or the session ends. */
    get holder(): string | null {
        return this.presence.holder;
    }

    /*
     * Whether an agent operates Ruimte now, as last heard: from an action aimed at Ruimte until the person
     * pauses or takes over, the session ends, or the actions went to other apps for the settle time, since
     * a click on another app lands on whatever window is in front and the last one may still be settling.
     */
    operatingRuimte(): boolean {
        const session = this.session;
        const active = session !== null && session.active;
        if (active && session.mode !== 'running') {
            return false;
        }
        if (this.ruimteActions > 0) {
            return true;
        }
        if (!active || !this.ruimteTargeted) {
            return false;
        }
        return this.awaySince === null || this.now() - this.awaySince < RUIMTE_SETTLE_MS;
    }

    /* The same, asked of the helper again when the answer would be yes, so a person who just took over is not refused for the next two seconds. */
    confirmOperatingRuimte(): Promise<boolean> {
        if (!this.operatingRuimte()) {
            return Promise.resolve(false);
        }
        this.confirming ??= this.helper
            .ask({ command: 'doctor', prompt: false }, DoctorResultSchema)
            .then((doctor) => this.heard(doctor?.session ?? null))
            // A helper that does not answer took nothing back, so what was last heard stands.
            .catch(() => undefined)
            .then(() => this.operatingRuimte())
            .finally(() => {
                this.confirming = null;
            });
        return this.confirming;
    }

    pendingApprovals(): ComputerApproval[] {
        return this.approvals.list();
    }

    answer(requestId: string, choice: ComputerApprovalChoice): Promise<boolean> {
        return this.approvals.answer(requestId, choice);
    }

    grants(): ComputerAppGrants {
        return { ...this.store.lasting(), thisTime: this.approvals.thisTimeGrants() };
    }

    /* A person takes a grant back. The next call of an agent in that app asks again, or is looked at for shells again. */
    async revoke(bundleId: string, kind: ComputerRevokeKind, nodeId?: string): Promise<boolean> {
        const removed =
            kind === 'always'
                ? await this.store.revokeAlways(bundleId)
                : kind === 'terminal'
                  ? await this.store.forgetTerminal(bundleId)
                  : this.approvals.revokeThisTime(bundleId, nodeId);
        this.publishGrants();
        return removed;
    }

    /* What the chats and terminals are doing: for the cursor of the agent that holds the session, and for how long "this time" lasts. */
    observe(event: SessionEvent): void {
        if (event.event === 'session.status') {
            const { sessionId, agent } = event.payload;
            if (agent) {
                this.approvals.agentStatus(sessionId, agent.status);
                this.presence.status(sessionId, agent.status);
                if (agent.status === 'exited') {
                    this.approvals.forget(sessionId);
                }
            }
        } else if (event.event === 'session.exit') {
            this.approvals.forget(event.payload.sessionId);
            this.presence.closed(event.payload.sessionId);
        } else if (event.event === 'chat.event') {
            const { chatId, event: chat } = event.payload;
            if (chat.type === 'item' && chat.item.kind === 'turn' && chat.item.state !== 'running') {
                this.approvals.turnEnded(chatId);
                this.presence.turnEnded(chatId, chat.item.state);
            } else if (chat.type === 'info') {
                this.approvals.agentStatus(chatId, chat.info.status);
                this.presence.status(chatId, chat.info.status);
            }
        }
    }

    /* A chat or terminal goes; a chat says nothing to an observer when it does. */
    nodeClosed(nodeId: string): void {
        this.callers.delete(nodeId);
        this.stopped.delete(nodeId);
        for (const key of this.trees.keys()) {
            if (key.startsWith(`${nodeId}\n`)) {
                this.trees.delete(key);
            }
        }
        this.approvals.forget(nodeId);
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
            this.noteSession(doctor?.session ?? null);
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
        this.approvals.dropThisTime();
        this.callers.clear();
        this.stopped.clear();
        this.trees.clear();
        this.presence.drop();
        await this.helper.quit();
        this.session = null;
        // Not asked again: the helper answers for a moment after it was told to quit.
        return this.setStatus({ ...this.current, enabled: false, running: false });
    }

    /* A person's interface language changed: the helper speaks it from its next action or presence on, since it reads the words again for each. */
    async setLanguage(language: string): Promise<void> {
        if (!this.store.enabled || language === this.store.language) {
            return;
        }
        await this.store.setLanguage(language);
        await this.writeOverlay();
    }

    /* macOS lists an app in a pane of Privacy & Security only once it asked for that grant, so the person finds it there to switch on. */
    async requestGrant(grant: ComputerGrant): Promise<ComputerUseStatus> {
        if (!this.store.enabled || !this.helper.present) {
            return this.refreshStatus();
        }
        const doctor = await this.helper.request({ command: 'doctor', prompt: true, grant }, DoctorResultSchema);
        this.noteSession(doctor.session ?? null);
        return this.setStatus({
            enabled: true,
            present: true,
            running: true,
            accessibility: doctor.accessibility.granted,
            screenRecording: doctor.screenRecording.granted
        });
    }

    /* Screen Recording applies to a fresh launch of the helper only, so a person who just granted it gets one without a command. */
    async restart(): Promise<ComputerUseStatus> {
        if (!this.store.enabled || !this.helper.present) {
            return this.refreshStatus();
        }
        this.presence.drop();
        await this.helper.quitAndWait();
        this.session = null;
        return this.refreshStatus();
    }

    /* A person's press on the node whose agent holds the Mac, which the helper takes as a press on its own session bar. */
    async control(action: ComputerControlAction): Promise<ComputerUseStatus> {
        if (!this.store.enabled) {
            return this.current;
        }
        const reply = await this.helper.ask({ command: action }, PressResultSchema);
        this.heard(reply?.session ?? null);
        return this.current;
    }

    /* Writes the pill's words for a helper that is on, and asks it for the grants so agents hear of the noun without a client asking first. */
    async start(): Promise<void> {
        if (this.store.enabled) {
            await this.writeOverlay();
            void this.refreshStatus();
        }
    }

    /* The daemon stops, and the helper with it: nobody is left to ask it anything. */
    async stop(): Promise<void> {
        this.cancelPoll?.();
        this.cancelPoll = null;
        await this.helper.quit();
    }

    /* Every app that runs, with how this caller stands with it. Asks nothing of a person and needs no hold on the Mac. */
    async apps(callerId: string): Promise<AppsOutcome> {
        const doctor = await this.ready();
        this.callers.add(callerId);
        this.refuseOnceIfStopped(callerId);
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

    /*
     * How a state reads to the agent that got it: whole, or only what changed against the last whole
     * tree it got for that app. Either way this tree is the one the next is told against.
     */
    treeView(callerId: string, state: StateResult, want: 'full' | 'diff'): TreeView {
        const key = `${callerId}\n${state.app.bundleId ?? state.app.pid}`;
        const after = rememberTree(state);
        const view: TreeView = want === 'full' ? { kind: 'full', reason: null } : diffTree(this.trees.get(key), after);
        this.trees.set(key, after);
        return view;
    }

    /*
     * `state` answers with the tree and the picture, `read` with one element whole, `wait` with whether it
     * happened and the state after; every other command with what it did. `holdMs` is how long the call
     * may wait for another agent to let go of the Mac, a card and the person's pause together; without
     * it the call holds the default for a card or a pause, and a Mac another agent holds refuses at once.
     */
    async operate(callerId: string, command: 'state', query: string, input: OperateInput, holdMs?: number): Promise<StateResult>;
    async operate(callerId: string, command: 'read', query: string, input: OperateInput, holdMs?: number): Promise<ReadResult>;
    async operate(callerId: string, command: 'wait', query: string, input: OperateInput, holdMs?: number): Promise<WaitResult>;
    async operate(
        callerId: string,
        command: Exclude<AppCommand, 'state' | 'read' | 'wait'>,
        query: string,
        input: OperateInput,
        holdMs?: number
    ): Promise<ActionResult>;
    async operate(callerId: string, command: AppCommand, query: string, input: OperateInput, holdMs?: number): Promise<HelperAnswer> {
        this.presence.calling(callerId);
        try {
            return await this.operateNow(callerId, command, query, input, Math.min(holdMs ?? this.waitMs, MAX_HOLD_MS), holdMs !== undefined);
        } finally {
            this.presence.acted(callerId);
        }
    }

    private async operateNow(callerId: string, command: AppCommand, query: string, input: OperateInput, holdMs: number, waits: boolean): Promise<HelperAnswer> {
        // One budget for the line, the card and the person's pause together, so a held call still ends inside the CLI's own limit.
        const deadline = this.now() + holdMs;
        await this.ready();
        this.callers.add(callerId);
        this.refuseOnceIfStopped(callerId);
        const run = this.runOf(callerId);
        if (run === null) {
            throw new ComputerRefusal('not-in-session', 'Only an agent in a chat or a terminal that runs now operates an app');
        }
        const { app, pid } = await this.target(command, query);
        if (await this.isTerminal(app.bundleId, app.name, pid, pid === null ? [] : await this.processes())) {
            throw terminalRefusal(app.name);
        }
        const ask = { callerId, run, app, command, caller: await this.describe(callerId) };
        if (!this.presence.take(callerId)) {
            if (!waits) {
                throw await this.busy();
            }
            // The card goes up while the agent is in line, so the person can answer before the Mac is free.
            if (this.approvals.raiseAhead(ask) === 'declined') {
                throw declinedRefusal(app.name);
            }
            await this.waitForTheMac(callerId, deadline);
        }
        const outcome = await this.approvals.ask(ask, Math.max(0, deadline - this.now()));
        if (outcome === 'waiting') {
            throw new ComputerRefusal(
                'awaiting-approval',
                `A card asking the person to let you operate ${app.name} is up in Ruimte; tell them, then call again with --wait 60, which holds until they answer`
            );
        }
        if (outcome === 'declined') {
            throw declinedRefusal(app.name);
        }
        await this.holdWhileHeld(deadline);
        const request: HelperRequest = { ...input, command, app: pid === null ? app.bundleId : String(pid) };
        const result = await this.aimed(app.bundleId, () =>
            this.act<HelperAnswer>(callerId, deadline, () => this.helper.request(request, ANSWER_SCHEMAS[command]))
        );
        // An app that did not run until now is checked once it does, before its tree or anything else of it goes back.
        if (command === 'open' && pid === null && result.app?.bundleId !== undefined) {
            if (await this.isTerminal(result.app.bundleId, result.app.name, result.app.pid, await this.processes())) {
                throw terminalRefusal(result.app.name);
            }
        }
        return result;
    }

    /* Holds a call in line until the Mac is this caller's, and refuses once its budget is spent or the session went without a word. */
    private async waitForTheMac(callerId: string, deadline: number): Promise<void> {
        while (!this.presence.take(callerId)) {
            const left = deadline - this.now();
            if (left <= 0) {
                throw await this.busy();
            }
            const outcome = await new Promise<LineOutcome | 'timeout'>((settle) => {
                const leave = this.presence.wait(callerId, (lineOutcome) => {
                    cancel();
                    settle(lineOutcome);
                });
                const cancel = this.timers.set(() => {
                    leave();
                    settle('timeout');
                }, left);
            });
            if (outcome === 'yours') {
                return;
            }
            if (outcome === 'timeout') {
                throw await this.busy();
            }
            if (outcome === 'gone') {
                throw new ComputerRefusal('not-in-session', 'Only an agent in a chat or a terminal that runs now operates an app');
            }
            if (!this.store.enabled) {
                throw offRefusal();
            }
            this.refuseOnceIfStopped(callerId);
        }
    }

    private async busy(): Promise<ComputerRefusal> {
        const holder = this.presence.holder;
        const caller = holder === null ? null : await this.describe(holder).catch(() => null);
        return busyRefusal(caller?.nodeTitle ?? null);
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

    /*
     * Whether an app is a terminal: seen running shells once, or doing so now. One seen now is remembered.
     * Ruimte never is: its shells run under the daemon, and `operated-ruimte.ts` holds its own limits.
     */
    private async isTerminal(bundleId: string, name: string, pid: number | null, rows: readonly ProcessRow[]): Promise<boolean> {
        if (RUIMTE_BUNDLE_IDS.has(bundleId)) {
            return false;
        }
        if (this.store.knownTerminal(bundleId)) {
            return true;
        }
        if (pid === null || !runsShells(pid, rows)) {
            return false;
        }
        await this.store.rememberTerminal(bundleId, name);
        this.publishGrants();
        return true;
    }

    /* One call that reaches the helper for an app, only while the caller still holds the Mac: its turn may have ended while it waited. */
    private async act<Result>(callerId: string, deadline: number, work: () => Promise<Result>): Promise<Result> {
        this.refuseOnceIfStopped(callerId);
        if (!this.presence.take(callerId)) {
            throw await this.busy();
        }
        this.presence.acting(callerId);
        let result: Result;
        try {
            result = await this.call(work);
        } catch (error) {
            // A refused action, such as a stale element, is routine: the agent reads the refusal and recovers, so the person sees no error.
            const code = error instanceof ComputerRefusal ? error.code : null;
            if (code === 'stopped') {
                // This refusal is how the agent hears of the stop, so its next call is not refused for it again.
                this.stopped.delete(callerId);
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

    /* `ours` is a session this machine ended itself, with `done` or `end`, which the holder already let go of. */
    private heard(session: HelperSession | null, ours = false): void {
        this.noteSession(session, ours);
        this.setStatus(this.current);
    }

    /*
     * An action for this app. One for Ruimte counts from before the helper acts, so the windows of Ruimte
     * are held back when its click lands, also as the first action of a session the helper has yet to start.
     */
    private async aimed<Result>(bundleId: string, work: () => Promise<Result>): Promise<Result> {
        const ruimte = RUIMTE_BUNDLE_IDS.has(bundleId);
        if (ruimte) {
            this.ruimteTargeted = true;
            this.ruimteActions += 1;
            this.awaySince = null;
        } else if (this.ruimteTargeted && this.awaySince === null) {
            this.awaySince = this.now();
        }
        this.setStatus(this.current);
        try {
            return await work();
        } finally {
            if (ruimte) {
                this.ruimteActions -= 1;
                this.setStatus(this.current);
            }
        }
    }

    private noteSession(session: HelperSession | null, ours = false): void {
        const stoppedNow = session?.stopped === true && this.session?.stopped !== true;
        const endedNow = this.session?.active === true && session?.active !== true;
        this.session = session;
        // An action on its way to Ruimte may be the one that starts the session.
        if ((session === null || !session.active) && this.ruimteActions === 0) {
            this.ruimteTargeted = false;
            this.awaySince = null;
        }
        if (stoppedNow) {
            this.personStopped();
        } else if (endedNow && !ours) {
            this.presence.helperEnded();
        }
    }

    /*
     * The person stopped the session, from the bar, a key, the menu or Ruimte. Every agent that called
     * since computer use was turned on hears so once, on its next call, whatever that is; a call in line
     * hears it at once. The helper forgets the stop, so an agent that heard it may start again.
     */
    private personStopped(): void {
        for (const caller of this.callers) {
            this.stopped.add(caller);
        }
        this.approvals.dropThisTime();
        this.presence.drop();
        this.clearing = this.helper
            .ask({ command: 'clear-stop' }, PressResultSchema)
            .then((reply) => this.heard(reply?.session ?? null))
            .catch((error: unknown) => this.log(`Clearing the stop of the computer use helper failed: ${errorText(error)}`));
    }

    private refuseOnceIfStopped(callerId: string): void {
        if (this.stopped.delete(callerId)) {
            throw new ComputerRefusal('stopped', STOPPED_WORDS);
        }
    }

    private async showPresence(show: PresenceShow): Promise<void> {
        const request: HelperRequest = {
            command: 'presence',
            state: show.state,
            ...(show.label === undefined ? {} : { label: show.label }),
            ...(show.ends ? { ends: true } : {})
        };
        const settles = show.state === 'done' || show.state === 'end' || show.ends === true;
        let reply;
        try {
            reply = await this.helper.ask(request, PresenceResultSchema);
        } catch (error) {
            if (error instanceof HelperFailure && error.helperCode === 'stopped') {
                this.heard({ active: false, mode: 'running', stopped: true });
            }
            throw error;
        }
        if (reply === null || !reply.session) {
            this.heard(reply === null ? null : { active: false, mode: 'running', stopped: false }, reply !== null && settles);
            return;
        }
        // The helper ends a session once `done` has faded, so it runs no more as far as anyone should show.
        this.heard({ active: !settles, mode: reply.mode, stopped: false }, settles);
    }

    /* On, present and able to read another app; anything short of that is refused before an app is named. */
    private async ready(): Promise<DoctorResult> {
        if (!this.store.enabled) {
            throw offRefusal();
        }
        const doctor = await this.call(() => this.helper.request({ command: 'doctor', prompt: false }, DoctorResultSchema));
        this.noteSession(doctor.session ?? null);
        this.setStatus({
            enabled: true,
            present: true,
            running: true,
            accessibility: doctor.accessibility.granted,
            screenRecording: doctor.screenRecording.granted
        });
        const missing = [...(doctor.accessibility.granted ? [] : ['Accessibility']), ...(doctor.screenRecording.granted ? [] : ['Screen Recording'])];
        if (missing.length > 0) {
            throw new ComputerRefusal(
                'not-granted',
                `Ruimte Computer Use does not have the ${missing.join(' and ')} ${missing.length === 1 ? 'permission' : 'permissions'} yet; only a person grants ${missing.length === 1 ? 'it' : 'them'}, in the Computer use settings of Ruimte`
            );
        }
        await this.clearing;
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
                throw new ComputerRefusal('stopped', STOPPED_WORDS);
            }
            if (error.helperCode === 'needs-front') {
                throw new ComputerRefusal('needs-front', agentWords(error.message));
            }
            throw new ComputerRefusal('app-refused', agentWords(error.message));
        }
    }

    private setStatus(status: ComputerUseStatus): ComputerUseStatus {
        const session = this.session;
        const waiting = this.presence.waiting;
        const next: ComputerUseStatus = {
            ...status,
            session:
                session !== null && session.active && status.running
                    ? { mode: session.mode, nodeId: this.presence.holder, ...(this.operatingRuimte() ? { operatingRuimte: true } : {}) }
                    : null
        };
        if (waiting.length > 0) {
            next.waiting = waiting;
        } else {
            delete next.waiting;
        }
        if (JSON.stringify(next) !== JSON.stringify(this.current)) {
            this.current = next;
            this.sinks.emit({ event: 'computer.status', payload: next });
        }
        this.pollWhileSession();
        return this.current;
    }

    /* Tells every client the list, once per change, whichever path changed it. */
    private publishGrants(): void {
        const grants = this.grants();
        const text = JSON.stringify(grants);
        if (text !== this.publishedGrants) {
            this.publishedGrants = text;
            this.sinks.emit({ event: 'computer.grants', payload: grants });
        }
    }

    private pollWhileSession(): void {
        if (!this.current.session) {
            this.cancelPoll?.();
            this.cancelPoll = null;
            return;
        }
        if (this.cancelPoll !== null) {
            return;
        }
        this.cancelPoll = this.timers.set(() => {
            this.cancelPoll = null;
            void this.helper
                .ask({ command: 'doctor', prompt: false }, DoctorResultSchema)
                .catch(() => null)
                .then((doctor) => this.heard(doctor?.session ?? null));
        }, SESSION_POLL_MS);
    }

    private async writeOverlay(): Promise<void> {
        const directory = helperDirectory(this.home);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeAtomic(join(directory, 'overlay.json'), `${JSON.stringify(overlayWords(this.store.language))}\n`, 0o600);
    }
}
