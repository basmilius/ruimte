import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ComputerApproval, ComputerApprovalChoice, ComputerUseStatus } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { CodedError } from '../coded-error.ts';
import { writeAtomic } from '../fs.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { ComputerApprovals, type AppRef, type CallerInfo, type Timers } from './approvals.ts';
import { HelperFailure, helperDirectory, type ComputerHelper } from './helper.ts';
import {
    ActionResultSchema,
    AppsResultSchema,
    DoctorResultSchema,
    StateResultSchema,
    type ActionResult,
    type AppCommand,
    type DoctorResult,
    type HelperRequest,
    type RunningApp,
    type StateResult
} from './helper-protocol.ts';
import type { ComputerUseStore } from './store.ts';
import { readProcessTable, runsShells, type ProcessRow, type ProcessTable } from './terminal-apps.ts';

/* A no to an agent: the code a script branches on, the sentence the model reads, what it may pick instead. */
export class ComputerRefusal extends CodedError {}

/* What the helper's pill says while an agent acts, in the languages the interface has. */
const OVERLAY_WORDS: Record<string, { title: string; hint: string }> = {
    en: { title: 'Ruimte is using your computer', hint: 'Esc to stop' },
    nl: { title: 'Ruimte bedient je computer', hint: 'Esc om te stoppen' }
};

export const overlayWords = (language: string | undefined): { title: string; hint: string } =>
    OVERLAY_WORDS[(language ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en'] ?? OVERLAY_WORDS.en!;

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
}

/* The fields of a helper request an agent's call fills, besides the command and the app. */
export type OperateInput = Omit<HelperRequest, 'command' | 'app' | 'secret' | 'prompt'>;

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
    private readonly sinks = new ClientSinks();
    private current: ComputerUseStatus;

    constructor(options: ComputerUseOptions) {
        this.home = options.home;
        this.store = options.store;
        this.helper = options.helper;
        this.runOf = options.runOf;
        this.describe = options.describe;
        this.processes = options.processes ?? readProcessTable;
        this.findApp = options.findApp ?? findInstalledApp;
        this.current = { enabled: options.store.enabled, present: options.helper.present, running: false, accessibility: null, screenRecording: null };
        this.approvals = new ComputerApprovals({
            grants: options.store,
            runOf: options.runOf,
            publish: (approvals) => this.sinks.emit({ event: 'computer.approvals', payload: { approvals } }),
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
        } else {
            this.approvals.dropAll();
            await this.helper.quit();
        }
        return this.refreshStatus();
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
        const request: HelperRequest = { ...input, command, app: pid === null ? app.bundleId : String(pid) };
        if (command === 'state') {
            return this.call(() => this.helper.request(request, StateResultSchema));
        }
        const result = await this.call(() => this.helper.request(request, ActionResultSchema));
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

    /* On, present and able to read another app; anything short of that is refused before an app is named. */
    private async ready(): Promise<DoctorResult> {
        if (!this.store.enabled) {
            throw new ComputerRefusal('computer-use-off', 'Computer use is off on this machine; only a person turns it on, in Ruimte');
        }
        const doctor = await this.call(() => this.helper.request({ command: 'doctor', prompt: false }, DoctorResultSchema));
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
            // The helper has worded it both ways.
            if (/^stopped by the (user|person)\b/.test(error.message)) {
                throw new ComputerRefusal('stopped', 'The person stopped you; ask them before you operate this app again');
            }
            throw new ComputerRefusal('app-refused', agentWords(error.message));
        }
    }

    private setStatus(next: ComputerUseStatus): ComputerUseStatus {
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
