/*
 * `createTestServer` of `@ruimte/extension/testing`: an extension's `server/index.ts` in the test's own process, on the
 * same `createServerApi` and policy as the machine, with memory for files, a clock the test turns and answers it scripts.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseExtensionActionInput } from '@ruimte/contracts/extension-actions';
import { extensionProjectPath } from '@ruimte/contracts/extension-client';
import { EXTENSION_PROBLEM_FILES, EXTENSION_PROBLEMS_PER_FILE, ExtensionProblemsReportSchema } from '@ruimte/contracts/extension-problems';
import { allowsProposed, proposedRefusal } from '@ruimte/contracts/extension-providers';
import type * as PublicServer from '../../../../packages/extension/server';
import type * as PublicTesting from '../../../../packages/extension/testing';
import { candidatesListed, launchesListed, machineStartDescribed } from './descriptions.ts';
import {
    askRefusal,
    eventRefusal,
    permissionsOf,
    problemSourceRefusal,
    SendLimit,
    terminalProfileRefusal,
    terminalWriteRefusal,
    type Refusal
} from './policy.ts';
import { callHandler, createServerApi, MissingHandler, type KeyValues, type ServerCore, type ServerMessage } from './server-api.ts';
import { loadFresh } from './test-loader.ts';

type Result<Value> = PublicServer.Result<Value>;
type Json = PublicServer.Json;
type Ask = PublicTesting.TestAsk;
type Answers = PublicTesting.TestServerAnswers;

const DURATION_UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

export class TestRefusal extends Error {
    readonly code: PublicServer.ExtensionErrorCode;

    constructor(code: PublicServer.ExtensionErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

export function refusal(code: PublicServer.ExtensionErrorCode, message: string): Error {
    return new TestRefusal(code, message);
}

/* As it crosses the pipe to the machine and back, so a value JSON cannot carry fails here and not only in Ruimte. */
function wire<Value>(value: unknown): Value {
    return JSON.parse(JSON.stringify(value ?? null)) as Value;
}

function failure(code: PublicServer.ExtensionErrorCode, message: string): Result<never> {
    return { ok: false, error: { code, message } };
}

function durationMs(duration: string | number): number {
    if (typeof duration === 'number') {
        return duration;
    }

    const match = /^(\d+)(ms|s|m|h)$/.exec(duration);

    if (match === null) {
        throw new TypeError(`advance takes milliseconds or something like 30s, 5m or 1h, not ${duration}`);
    }

    return Number(match[1]) * (DURATION_UNITS[match[2] as string] as number);
}

function tooManyProblems(file: unknown): boolean {
    const problems = (file as { problems?: unknown } | null)?.problems;

    return Array.isArray(problems) && problems.length > EXTENSION_PROBLEMS_PER_FILE;
}

type TestManifest = NonNullable<PublicTesting.TestServerOptions['manifest']>;

function manifestIn(folder: string): TestManifest {
    try {
        return JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as TestManifest;
    } catch {
        return {};
    }
}

const TEST_PROJECT: PublicServer.ProjectInfo = { id: 'project-1', name: 'Project', folder: '/project' };

function memory(values: Record<string, unknown>, changed: () => void = () => undefined): KeyValues {
    return {
        get: async (key) => (Object.hasOwn(values, key) ? wire(values[key]) : undefined),
        set: async (key, value) => {
            // A key set to undefined crosses as none, as on the machine.
            if (value === undefined) {
                delete values[key];
            } else {
                values[key] = wire(value);
            }

            changed();
        },
        delete: async (key) => {
            delete values[key];
            changed();
        }
    };
}

const folders = new Set<string>();

/* Removes the data folder of every test server, which the test runtime does once the tests are done. */
export function removeTestFolders(): void {
    for (const folder of folders) {
        rmSync(folder, { recursive: true, force: true });
    }

    folders.clear();
}

/* What a test host reads of a test server it was handed, so the client's `machine` storage is the same keys `server/` keeps. */
export const machineStorageOf = new WeakMap<object, { values: Record<string, Json>; subscribe(listener: () => void): () => void }>();

/* The wire's `agents.start` back in the words of the API, as an answer reads it. */
function startOptions(start: {
    projectId: string;
    folder?: string;
    viewId?: string;
    beside?: string;
    prompt?: string;
    provider?: string;
    title?: string;
    hidden?: boolean;
}) {
    return {
        ...(start.projectId === '' ? {} : { project: { id: start.projectId } }),
        ...(start.folder === undefined ? {} : { folder: start.folder }),
        ...(start.hidden === true ? { hidden: true } : {}),
        ...(start.viewId === undefined ? {} : { view: { id: start.viewId } }),
        ...(start.beside === undefined ? {} : { near: [{ id: start.beside }] }),
        ...(start.prompt === undefined ? {} : { prompt: start.prompt }),
        ...(start.provider === undefined ? {} : { provider: start.provider }),
        ...(start.title === undefined ? {} : { title: start.title })
    };
}

interface Scheduled {
    every: number;
    due: number;
    run(): Promise<void>;
}

class TestMachine {
    readonly id: string;
    readonly storage: Record<string, Json>;
    readonly secrets: Record<string, string>;
    readonly emitted: { name: string; payload?: Json }[] = [];
    readonly storageListeners = new Set<() => void>();
    readonly asked: Ask[] = [];
    readonly languageServers: object[] = [];
    readonly logs: string[] = [];
    readonly terminals: PublicTesting.TestTerminal[];
    readonly profiles = new Map<string, { title: string; icon?: string }>();
    readonly launchSources = new Map<string, { title: string; changes: number }>();
    readonly problemSources = new Map<string, string>();
    readonly machineSources = new Map<string, string>();
    // The lines a machine source reported while it described a start, by the number it was asked under.
    readonly machineReports = new Map<number, string[]>();
    nextMachineStart = 1;
    readonly problems: { source: string; files: PublicServer.FileProblems[] }[] = [];
    readonly files: Record<string, string>;
    readonly project: PublicServer.ProjectInfo;
    readonly core: ServerCore;
    // Why the machine would not run this extension at all, such as a proposed part in one a person installed.
    readonly notRun: string | null;

    private readonly permissions: ReadonlySet<string>;
    private readonly manifest: TestManifest & { id: string };
    private readonly proposedAllowed: boolean;
    private readonly answers: Answers;
    private readonly subscriptions = new Set<string>();
    private readonly tools = new Map<string, boolean>();
    private readonly scheduled: Scheduled[] = [];
    // The files and folders `files.watch` follows, by the number each asked under, as the path in the project.
    private readonly fileWatches = new Map<number, string>();
    private readonly sends: SendLimit;
    private now = 0;

    constructor(options: PublicTesting.TestServerOptions, folder: string) {
        const manifest = { ...manifestIn(folder), ...options.manifest };

        // An author's own run is a dev link, where a proposed part works; a test names `installed` to see what a person gets.
        const provenance = options.provenance ?? 'dev-link';

        this.id = manifest.id ?? 'test.extension';
        this.manifest = { ...manifest, id: this.id };
        this.proposedAllowed = allowsProposed(provenance);
        this.notRun = proposedRefusal(this.manifest, provenance);
        this.project = { ...TEST_PROJECT, ...options.project };
        this.terminals = (options.terminals ?? []).map((terminal) => ({ openedBy: 'person', needsYou: false, written: [], ...terminal }));
        this.permissions = permissionsOf(manifest);
        this.answers = options.answers ?? {};
        this.storage = wire(options.storage ?? {});
        this.files = { ...options.files };
        this.secrets = { ...options.secrets };
        this.sends = new SendLimit(() => this.now);
        // A folder of its own that exists, as the machine gives each extension, so two test servers share nothing.
        const dataFolder = mkdtempSync(join(tmpdir(), `ruimte-extension-test-${this.id}-`));

        folders.add(dataFolder);
        this.core = createServerApi({
            dataFolder,
            platform: process.platform,
            permissions: this.permissions,
            provides: this.manifest,
            proposedAllowed: this.proposedAllowed,
            ask: (method, args) => this.ask(method, args),
            clock: {
                every: (every, run) => {
                    this.scheduled.push({ every, due: this.now + every, run });
                }
            },
            send: (message) => this.said(message),
            storage: memory(this.storage, () => {
                for (const listener of [...this.storageListeners]) {
                    listener();
                }
            }),
            secrets: memory(this.secrets),
            log: {
                info: (message) => void this.logs.push(message),
                error: (message, error) =>
                    void this.logs.push(error === undefined ? message : `${message} ${error instanceof Error ? error.message : String(error)}`)
            }
        });
    }

    clockNow(): number {
        return this.now;
    }

    async advance(duration: string | number): Promise<void> {
        const until = this.now + durationMs(duration);

        for (let next = this.nextDue(until); next !== null; next = this.nextDue(until)) {
            this.now = next.due;
            next.due += next.every;
            await next.run();
        }

        this.now = until;
    }

    private nextDue(until: number): Scheduled | null {
        const due = this.scheduled.filter((task) => task.due <= until).sort((left, right) => left.due - right.due);

        return due[0] ?? null;
    }

    fire(name: string, payload: unknown): void {
        if (this.subscriptions.has(name)) {
            this.core.deliver(name, wire(payload));
        }
    }

    async runTool(id: string, input: object, caller: string): Promise<string> {
        if (this.tools.get(id) !== true) {
            const missing = `No tool ${this.id}/${id}. tool_list says what there is`;

            throw new Error(this.tools.has(id) ? `${missing}. defineAgentTool needs the permission agents.tools in manifest.json` : missing);
        }

        const answer = await this.core.runTool(id, wire(input), { caller });

        return typeof answer === 'string' ? answer : JSON.stringify(answer);
    }

    private said(message: ServerMessage): void {
        if (message.type === 'emit') {
            // Without a payload it sends none, as over the pipe; a client hears undefined.
            this.emitted.push(message.payload === undefined ? { name: message.name } : { name: message.name, payload: wire(message.payload) });
        } else if (message.type === 'tool') {
            // The machine lists a tool only with the permission, and says nothing of one without it.
            this.tools.set(message.name, this.permissions.has('agents.tools'));
        } else if (message.type === 'profile') {
            this.profiles.set(message.id, { title: message.title, ...(message.icon === undefined ? {} : { icon: message.icon }) });
        } else if (message.type === 'launchSource') {
            this.launchSources.set(message.id, { title: message.title, changes: 0 });
        } else if (message.type === 'launchesChanged') {
            const source = this.launchSources.get(message.source);

            if (source !== undefined) {
                source.changes += 1;
            }
        } else if (message.type === 'problemSource') {
            this.problemSources.set(message.id, message.title);
        } else if (message.type === 'machineSource') {
            this.machineSources.set(message.id, message.title);
        } else if (message.type === 'machineReport') {
            this.machineReports.get(message.run)?.push(message.line);
        } else {
            const reason = eventRefusal(message.name, this.permissions);

            if (reason === null) {
                this.subscriptions.add(message.name);
            } else {
                this.logs.push(reason);
            }
        }
    }

    /*
     * What the host answers an ask, in its order: the permission, the input of an action, an answer at all, the sends of the
     * hour, then the answer. An input of the wrong shape throws, as the extension's own mistake.
     */
    private async ask(method: string, args: unknown[]): Promise<Result<unknown>> {
        const refused = askRefusal(this.id, method, args, this.permissions);

        if (refused === null && method === 'action') {
            args = [args[0], args[1], this.actionInput(args[1] as PublicServer.MachineActionName, args[2])];
        }

        const [name, recorded] = this.named(method, args);
        const result = refused === null ? await this.answer(method, args) : this.refused(method, refused);

        // Letting go of a watch is the function `files.watch` answered, which a test sees as changes it no longer hears.
        if (method !== 'files.unwatch') {
            this.asked.push({ method: name, args: wire(recorded), result });
        }

        return result;
    }

    /* The key of a file of the project in `files`, or why the machine would not read it. */
    private fileKey(method: string, projectId: unknown, path: unknown): { key: string } | Result<never> {
        if (projectId !== this.project.id) {
            return this.refused(method, { code: 'not-found', message: `No project ${String(projectId)} on this machine` });
        }

        const full = extensionProjectPath(this.project.folder, String(path));

        if (full === null) {
            return this.refused(method, { code: 'outside-project', message: `${String(path)} is outside the project folder` });
        }

        return {
            key: full
                .slice(this.project.folder.length)
                .replace(/^[\\/]+/, '')
                .replaceAll('\\', '/')
        };
    }

    private answerFiles(method: string, args: unknown[]): Result<unknown> {
        if (method === 'files.unwatch') {
            this.fileWatches.delete(Number(args[0]));

            return { ok: true, value: null };
        }

        const at = this.fileKey(method, args[0], args[1]);

        if (!('key' in at)) {
            return at;
        }

        if (method === 'files.watch') {
            this.fileWatches.set(Number(args[2]), at.key);

            return { ok: true, value: null };
        }

        if (method === 'files.readText') {
            return Object.hasOwn(this.files, at.key)
                ? { ok: true, value: this.files[at.key] }
                : this.refused(method, { code: 'not-found', message: `No file ${String(args[1])} in the project` });
        }

        const under = at.key === '' ? '' : `${at.key}/`;
        const names = new Map<string, PublicServer.FileEntry['kind']>();

        for (const path of Object.keys(this.files)) {
            if (path.startsWith(under)) {
                const [name, ...deeper] = path.slice(under.length).split('/') as [string, ...string[]];

                names.set(name, deeper.length === 0 ? 'file' : 'directory');
            }
        }

        return {
            ok: true,
            value: [...names]
                .sort(([left, leftKind], [right, rightKind]) => (leftKind === rightKind ? left.localeCompare(right) : leftKind === 'directory' ? -1 : 1))
                .map(([name, kind]) => ({ path: `${this.project.folder}/${under}${name}`, name, kind }))
        };
    }

    /* A test's change to a file of the project, told to every watch of it or of a folder above it. */
    writeFile(path: string, text: string | null): void {
        if (text === null) {
            delete this.files[path];
        } else {
            this.files[path] = text;
        }

        for (const [watch, watched] of [...this.fileWatches]) {
            if (watched === '' || watched === path || path.startsWith(`${watched}/`)) {
                this.core.fileChanged(watch);
            }
        }
    }

    private answerProblems(method: string, args: unknown[]): Result<unknown> {
        const [projectId, source, reported] = args as [unknown, string, unknown];
        const refused = problemSourceRefusal(this.manifest, String(source), this.proposedAllowed);

        if (refused !== null) {
            return this.refused(method, refused);
        }

        if (projectId !== this.project.id) {
            return this.refused(method, { code: 'not-found', message: `No project ${String(projectId)} on this machine` });
        }

        const held = this.problems.find((entry) => entry.source === source);

        if (method === 'problems.clear') {
            if (held !== undefined) {
                this.problems.splice(this.problems.indexOf(held), 1);
            }

            return { ok: true, value: null };
        }

        const limit = `A source reports at most ${EXTENSION_PROBLEMS_PER_FILE} problems per file and ${EXTENSION_PROBLEM_FILES} files at once`;

        if (Array.isArray(reported) && (reported.length > EXTENSION_PROBLEM_FILES || reported.some((file) => tooManyProblems(file)))) {
            return this.refused(method, { code: 'limit', message: limit });
        }

        const parsed = ExtensionProblemsReportSchema.safeParse(args);

        if (!parsed.success) {
            this.logs.push(`${method} answered invalid-input: ${parsed.error.issues[0]?.message ?? 'invalid'}`);

            throw new TypeError(`problems.report takes another shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
        }

        if (!this.problemSources.has(source)) {
            return this.refused(method, { code: 'not-found', message: `${this.id} lists the problem source ${source} and did not define it` });
        }

        const files = new Map((held?.files ?? []).map((file) => [file.path, file]));

        for (const file of parsed.data[2]) {
            const at = this.fileKey(method, projectId, file.path);

            if (!('key' in at)) {
                return at;
            }

            if (file.problems.length === 0) {
                files.delete(at.key);
            } else {
                files.set(at.key, { path: at.key, problems: file.problems });
            }
        }

        if (files.size > EXTENSION_PROBLEM_FILES) {
            return this.refused(method, { code: 'limit', message: limit });
        }

        if (held === undefined) {
            this.problems.push({ source, files: [...files.values()] });
        } else {
            held.files = [...files.values()];
        }

        return { ok: true, value: null };
    }

    private actionInput(action: PublicServer.MachineActionName, input: unknown): unknown {
        const parsed = parseExtensionActionInput(action, wire(input));

        if (!parsed.ok) {
            this.logs.push(`action answered invalid-input: ${parsed.message}`);

            throw new TypeError(parsed.message);
        }

        return parsed.input;
    }

    private refused(method: string, { code, message }: Refusal): Result<never> {
        this.logs.push(`${method} answered ${code}: ${message}`);

        return failure(code, message);
    }

    private named(method: string, args: unknown[]): [Ask['method'], unknown[]] {
        if (method === 'action') {
            return ['machine.run', [{ id: args[0] }, args[1], args[2]]];
        }

        if (method === 'languages.add') {
            return ['defineLanguageServer', args];
        }

        if (method === 'agents.start') {
            return ['agents.start', [startOptions(args[0] as Parameters<typeof startOptions>[0])]];
        }

        if (method === 'terminals.open') {
            const { projectId, beside, ...rest } = args[0] as { projectId: string; beside?: string };

            return ['terminals.open', [{ project: { id: projectId }, ...rest, ...(beside === undefined ? {} : { near: [{ id: beside }] }) }]];
        }

        if (method === 'terminals.write' || method === 'terminals.read') {
            return [method, [{ id: args[0] }, ...args.slice(1)]];
        }

        // The number a watch asks under is the pipe's own.
        if (method === 'files.watch') {
            return [method, [{ id: args[0] }, args[1]]];
        }

        if (method.startsWith('files.') || method.startsWith('problems.')) {
            return [method as Ask['method'], [{ id: args[0] }, ...args.slice(1)]];
        }

        return [method as Ask['method'], args];
    }

    private async answer(method: string, args: unknown[]): Promise<Result<unknown>> {
        if (method === 'languages.add') {
            this.languageServers.push(wire(args[0]));

            return { ok: true, value: null };
        }

        if (method === 'terminals.open') {
            return this.openTerminal(args[0] as { projectId: string; profile?: string; title?: string; cwd?: string });
        }

        if (method === 'terminals.write') {
            return this.writeTerminal(String(args[0]), String(args[1]));
        }

        if (method.startsWith('files.')) {
            return this.answerFiles(method, args);
        }

        if (method.startsWith('problems.')) {
            return this.answerProblems(method, args);
        }

        const answer = this.scripted(method, args);

        if (answer === null) {
            return this.refused(method, { code: 'unavailable', message: `Nothing answers ${method} in this test. Give it under answers` });
        }

        if (method === 'chats.send') {
            const limited = this.sends.take(this.id, String(args[0]));

            if (limited !== null) {
                return this.refused(method, limited);
            }
        }

        try {
            const value = await answer();

            return { ok: true, value: wire(method === 'agents.start' ? { nodeId: (value as PublicServer.NodeRef).id } : value) };
        } catch (e) {
            if (e instanceof TestRefusal) {
                return this.refused(method, { code: e.code, message: e.message });
            }

            return this.refused(method, { code: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
    }

    /*
     * The machine of a test opens the terminal itself and keeps what it would: who opened it, the profile that starts
     * it and what that profile's `spawn` described, asked as the machine asks it once the session starts.
     */
    private async openTerminal(open: { projectId: string; profile?: string; title?: string; cwd?: string }): Promise<Result<unknown>> {
        const { profile, title, cwd } = open;
        const refused = profile === undefined ? null : terminalProfileRefusal(this.manifest, profile, this.proposedAllowed);

        if (refused !== null) {
            return this.refused('terminals.open', refused);
        }

        if (profile !== undefined && !this.profiles.has(profile)) {
            return this.refused('terminals.open', { code: 'not-found', message: `${this.id} lists the terminal profile ${profile} and did not define it` });
        }

        const id = `terminal-${this.terminals.length + 1}`;
        const terminal: PublicTesting.TestTerminal = {
            id,
            openedBy: 'extension',
            needsYou: false,
            written: [],
            ...(profile === undefined ? {} : { profile }),
            ...(title === undefined ? {} : { title }),
            ...(cwd === undefined ? {} : { cwd })
        };

        if (profile !== undefined) {
            try {
                terminal.spawn = wire(await this.core.askProfile(profile, 'spawn', { project: this.project, cwd: cwd ?? this.project.folder }));
            } catch (e) {
                return this.refused('terminals.open', { code: 'failed', message: e instanceof Error ? e.message : String(e) });
            }
        }

        this.terminals.push(terminal);

        return { ok: true, value: { nodeId: id } };
    }

    private writeTerminal(nodeId: string, text: string): Result<unknown> {
        const terminal = this.terminals.find((candidate) => candidate.id === nodeId);
        const record = terminal === undefined ? null : { openedBy: terminal.openedBy === 'extension' ? this.id : undefined };
        const refused = terminalWriteRefusal(this.id, nodeId, record, terminal?.needsYou === true);

        if (refused !== null) {
            return this.refused('terminals.write', refused);
        }

        terminal?.written.push(text);

        return { ok: true, value: null };
    }

    private scripted(method: string, args: unknown[]): (() => unknown) | null {
        const answers = this.answers as Record<string, ((...values: unknown[]) => unknown) | undefined>;

        if (method === 'action') {
            const [projectId, action, input] = args as [string, string, unknown];
            const run = (
                this.answers['machine.run'] as Record<string, ((input: unknown, project: PublicServer.ProjectRef) => unknown) | undefined> | undefined
            )?.[action];

            return run === undefined ? null : () => run(wire(input), { id: projectId });
        }

        const run = answers[method];

        if (run === undefined) {
            return null;
        }

        if (method === 'terminals.read') {
            return () => run({ id: args[0] });
        }

        return method === 'agents.start' ? () => run(startOptions(args[0] as Parameters<typeof startOptions>[0])) : () => run(...wire<unknown[]>(args));
    }
}

let current: TestMachine | null = null;

/*
 * The machine `@ruimte/extension/server` speaks for in a file a test imports itself: the test server created last, or one of
 * the manifest alone outside of one. What a test server loaded speaks for that server.
 */
export function currentServer(): typeof PublicServer {
    current ??= new TestMachine({}, process.cwd());

    return current.core.server;
}

export async function createTestServer<Api>(options: PublicTesting.TestServerOptions = {}): Promise<PublicTesting.TestServer<Api>> {
    const folder = process.cwd();
    const machine = new TestMachine(options, folder);

    current = machine;

    if (machine.notRun !== null) {
        throw new Error(machine.notRun);
    }

    const module = await loadFresh(resolve(folder, options.entry ?? join('server', 'index.ts')), { '@ruimte/extension/server': machine.core.server });
    const handlers = (module.default ?? {}) as Record<string, unknown>;

    const call = async (method: string, ...args: unknown[]): Promise<Result<unknown>> => {
        try {
            return { ok: true, value: wire(await callHandler(handlers, method, wire(args))) };
        } catch (e) {
            return failure(e instanceof MissingHandler ? 'not-found' : 'failed', e instanceof Error ? e.message : String(e));
        }
    };

    const server: PublicTesting.TestServer<Api> = {
        // Typed by the author's `Api`, which only the default export of `server/index.ts` holds to.
        call: call as unknown as PublicTesting.TestServer<Api>['call'],
        storage: machine.storage,
        secrets: machine.secrets,
        clock: { now: () => machine.clockNow(), advance: (duration) => machine.advance(duration) },
        fire: (name, payload) => machine.fire(name, payload),
        emitted: machine.emitted,
        asked: machine.asked,
        languageServers: machine.languageServers,
        logs: machine.logs,
        terminals: machine.terminals,
        profile: (id) => {
            const defined = machine.profiles.get(id);

            if (defined === undefined) {
                throw new Error(`No terminal profile ${id}. defineTerminalProfile says what there is`);
            }

            return {
                ...defined,
                available: async (project = {}) => (await machine.core.askProfile(id, 'available', { ...machine.project, ...project })) !== false,
                spawn: async (context = {}) =>
                    wire(
                        await machine.core.askProfile(id, 'spawn', {
                            project: { ...machine.project, ...context.project },
                            cwd: context.cwd ?? context.project?.folder ?? machine.project.folder
                        })
                    )
            };
        },
        launchSource: (id) => {
            const defined = machine.launchSources.get(id);

            if (defined === undefined) {
                throw new Error(`No launch source ${id}. defineLaunchSource says what there is`);
            }

            return {
                title: defined.title,
                get changes() {
                    return defined.changes;
                },
                list: async (project = {}) => {
                    const asked = { ...machine.project, ...project };
                    const listed = launchesListed(wire(await machine.core.askLaunchSource(id, 'list', asked)), (reason) => {
                        machine.logs.push(`${id} ${reason}`);
                    });

                    await machine.core.askLaunchSource(id, 'watch', asked);

                    return listed;
                },
                stop: async (project = {}) => {
                    await machine.core.askLaunchSource(id, 'unwatch', { ...machine.project, ...project });
                }
            };
        },
        machineSource: (id) => {
            const title = machine.machineSources.get(id);

            if (title === undefined) {
                throw new Error(`No machine source ${id}. defineMachineSource says what there is`);
            }

            const list = async (project: Partial<PublicServer.ProjectInfo> = {}) =>
                candidatesListed(wire(await machine.core.askMachineSource(id, 'list', { project: { ...machine.project, ...project } })), (reason) => {
                    machine.logs.push(`${id} ${reason}`);
                });

            return {
                title,
                list,
                start: async (candidateId, options = {}) => {
                    const project = { ...machine.project, ...options.project };
                    const candidate = (await list(project)).find((listed) => listed.id === candidateId);

                    if (candidate === undefined) {
                        throw new Error(`${id} lists no place ${candidateId}`);
                    }

                    const run = machine.nextMachineStart;
                    const reports: string[] = [];
                    const abort = (): void => machine.core.abortMachineStart(run);

                    machine.nextMachineStart += 1;
                    machine.machineReports.set(run, reports);
                    options.signal?.addEventListener('abort', abort);

                    try {
                        const asked = machine.core.askMachineSource(id, 'start', { project, candidate, run });

                        // A stop from before the ask still reaches the source, after the ask it is about.
                        if (options.signal?.aborted === true) {
                            abort();
                        }

                        return { start: machineStartDescribed(wire(await asked)), reports };
                    } finally {
                        machine.machineReports.delete(run);
                        options.signal?.removeEventListener('abort', abort);
                    }
                }
            };
        },
        problems: machine.problems,
        files: machine.files,
        writeFile: (path, text) => machine.writeFile(path, text),
        tool: (id) => ({ run: (input = {}, context = {}) => machine.runTool(id, input, context.caller ?? 'test') }),
        nodeContext: async (nodeType, data) => wire(await machine.core.readNodeContext(nodeType, wire(data)))
    };

    machineStorageOf.set(server, {
        values: machine.storage,
        subscribe: (listener) => {
            machine.storageListeners.add(listener);

            return () => {
                machine.storageListeners.delete(listener);
            };
        }
    });

    return server;
}
