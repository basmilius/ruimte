import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { isNotFound } from '@adecore/utils/errors';
import {
    allowsProposed,
    ANSWER_TIMEOUT_MS,
    EXTENSION_API_VERSION,
    EXTENSION_PROBLEM_FILES,
    EXTENSION_PROBLEMS_PER_FILE,
    EXTENSION_TERMINAL_TEXT_MAX,
    ExtensionProblemsClearSchema,
    ExtensionProblemsReportSchema,
    ExtensionProvidedIdSchema,
    providedIds,
    proposedRefusal,
    providerRefusal,
    type ExtensionActionName,
    type ExtensionFileProblems,
    type ExtensionInfo,
    type ExtensionManifest,
    type ExtensionStatus,
    type ExtensionTerminalProfile
} from '@ruimte/contracts';
import { z } from 'zod';
import { bestEffort } from '../best-effort.ts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { bunRuntime } from '../language/runtime.ts';
import type { SessionSink } from '../wire.ts';
import { clientFilesOf } from './client-files.ts';
import {
    candidatesListed,
    launchesListed,
    machineStartDescribed,
    SpawnDescriptionSchema,
    type LaunchDescription,
    type MachineCandidateDescription,
    type MachineStartDescription,
    type SpawnDescription
} from './descriptions.ts';
// @ts-expect-error Bun hands over the file's text, so a compiled daemon carries it; TypeScript only knows the module.
import runtimeSource from './generated/server-runtime.js' with { type: 'text' };
import {
    actionRefusal,
    askRefusal,
    eventPayload,
    eventRefusal,
    missingPermission,
    permissionsOf,
    problemSourceRefusal,
    SendLimit,
    startsWithMachine,
    terminalProfileRefusal,
    type Refusal
} from './policy.ts';
import { extensionProvenance } from './provenance.ts';
import { ExtensionRefusal, extensionFailureOf } from './refusal.ts';
import { ownValue, parseKeyValues } from './server-api.ts';
import { isDamaged, manifestOfPack, type DamagedExtension, type ExtensionStore, type StoredExtension } from './store.ts';

const MAX_CRASHES = 3;
const KILL_AFTER_MS = 5_000;
const RUNTIME_FILE = 'runtime.js';

function refuse(refusal: Refusal | null): void {
    if (refusal !== null) {
        throw new ExtensionRefusal(refusal.code, refusal.message);
    }
}

const ProtocolMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ask'), id: z.number(), method: z.string(), args: z.array(z.unknown()) }),
    z.object({ type: z.literal('tool'), name: z.string(), description: z.string(), parameters: z.unknown().optional() }),
    z.object({ type: z.literal('ready') }),
    z.object({ type: z.literal('subscribe'), name: z.string() }),
    z.object({ type: z.literal('profile'), id: z.string(), title: z.string().min(1).max(80), icon: z.string().max(60).optional(), available: z.boolean() }),
    z.object({ type: z.literal('launchSource'), id: z.string(), title: z.string().min(1).max(80), watches: z.boolean() }),
    z.object({ type: z.literal('launchesChanged'), source: z.string(), projectId: z.string() }),
    z.object({ type: z.literal('problemSource'), id: z.string(), title: z.string().min(1).max(80) }),
    z.object({ type: z.literal('machineSource'), id: z.string(), title: z.string().min(1).max(80) }),
    z.object({ type: z.literal('machineReport'), run: z.number(), line: z.string() }),
    z.object({ type: z.literal('notificationChannel'), id: z.string(), title: z.string().min(1).max(80) }),
    z.object({ type: z.literal('emit'), name: z.string(), payload: z.unknown().optional() }),
    z.object({ type: z.literal('result'), id: z.number(), result: z.unknown().optional(), error: z.string().optional(), code: z.string().optional() })
]);
type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>;

function protocolMessage(line: string): ProtocolMessage | null {
    let value: unknown;

    try {
        value = JSON.parse(line);
    } catch {
        return null;
    }

    const parsed = ProtocolMessageSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
}

/*
 * A row for one whose files cannot be read: off, with nothing to load, and named only by its id. A client from before
 * `error` shows it as turned off, which it is, and can still remove it.
 */
function damagedInfo({ id, error }: DamagedExtension): ExtensionInfo {
    return {
        manifest: { id, name: id, version: '0.0.0', api: EXTENSION_API_VERSION },
        hash: 'damaged',
        enabled: false,
        hasServer: false,
        hasClient: false,
        status: 'disabled',
        error
    };
}

function tooManyProblems(file: unknown): boolean {
    const problems = (file as { problems?: unknown } | null)?.problems;

    return Array.isArray(problems) && problems.length > EXTENSION_PROBLEMS_PER_FILE;
}

function stopped(): ExtensionRefusal {
    return new ExtensionRefusal('unavailable', 'The extension stopped');
}

interface Pending {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

interface Running {
    child: ChildProcessWithoutNullStreams;
    ready: Promise<void>;
    failStart(reason: Error): void;
    pending: Map<number, Pending>;
    permissions: ReadonlySet<string>;
    // The manifest it started with, and whether a proposed part works for where it came from.
    manifest: ExtensionManifest;
    proposedAllowed: boolean;
    // The terminal profiles its module defined, by id.
    profiles: Map<string, DefinedProfile>;
    // The launch sources and problem sources its module defined, by id.
    launchSources: Map<string, { title: string; watches: boolean }>;
    problemSources: Map<string, { title: string }>;
    machineSources: Map<string, { title: string }>;
    // Who reads the lines a machine source reports while it describes a start, by the number it was asked under.
    machineReports: Map<number, (line: string) => void>;
    notificationChannels: Map<string, { title: string }>;
    subscriptions: Set<string>;
    nextCall: number;
    buffered: string;
    stopping: boolean;
    // Settles once the process is gone, which a kill only asks for.
    ended: Promise<void>;
}

interface Starting {
    promise: Promise<Running>;
    // Set by a stop that comes before the process is there, so the start ends without one.
    attempt: { cancelled: boolean };
}

interface DefinedProfile {
    title: string;
    icon?: string | undefined;
    // Whether it has a say in which project it shows in.
    available: boolean;
}

/* A project as a provider of an extension is asked about it. */
export interface ExtensionProject {
    id: string;
    name: string;
    folder: string;
}

export type { SpawnDescription };

/* What one launch source of an extension lists in a project. */
export interface SourceListing {
    extension: string;
    source: string;
    title: string;
    // Whether it tells when its list changed, so the machine asks it to.
    watches: boolean;
    launches: LaunchDescription[];
}

/* What one machine source of an extension lists in a project. */
export interface MachineSourceListing {
    extension: string;
    source: string;
    title: string;
    candidates: MachineCandidateDescription[];
}

const FileReadAskSchema = z.tuple([z.string().min(1), z.string().min(1)]);
const FileWatchAskSchema = z.tuple([z.string().min(1), z.string().min(1), z.number().int().positive()]);

/* The files of a project, as far as an extension's `server/` reads them: inside its folder only. */
export interface ExtensionFilesPort {
    readText(projectId: string, path: string): Promise<string>;
    list(projectId: string, folder: string): Promise<unknown>;
    /* Follows a file or folder for one extension under a number of its own, until `unwatch` or `unwatchAll`. */
    watch(extensionId: string, watch: number, projectId: string, path: string, changed: () => void): Promise<void>;
    unwatch(extensionId: string, watch: number): void;
    unwatchAll(extensionId: string): void;
}

/* Where the problems of an extension's sources go: beside what the language servers report. */
export interface ExtensionProblemsPort {
    report(source: { extension: string; id: string; title: string }, projectId: string, files: readonly ExtensionFileProblems[]): Promise<void>;
    clear(extension: string, source: string, projectId: string): void;
    /* Everything an extension said, in every project. */
    drop(extension: string): void;
}

const TerminalOpenAskSchema = z.object({
    projectId: z.string().min(1),
    profile: ExtensionProvidedIdSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    cwd: z.string().min(1).optional(),
    beside: z.string().min(1).optional()
});
const TerminalWriteAskSchema = z.tuple([z.string().min(1), z.string().min(1).max(EXTENSION_TERMINAL_TEXT_MAX)]);

interface ExtensionTerminalStart {
    projectId: string;
    profile?: string | undefined;
    picked?: boolean | undefined;
    title?: string | undefined;
    cwd?: string | undefined;
    viewId?: string | undefined;
    beside?: string | undefined;
    at?: { x: number; y: number } | undefined;
}

/* The terminals of the machine, as far as an extension reaches them. */
export interface ExtensionTerminalPort {
    // `check` throws once the extension was turned off, changed or removed since it was granted.
    open(extensionId: string, start: ExtensionTerminalStart, check: () => void): Promise<{ nodeId: string }>;
    /* Types into a terminal, or refuses with what the machine itself keeps of who opened it. */
    write(extensionId: string, nodeId: string, text: string): Promise<void>;
    read(nodeId: string): Promise<string>;
}

/* What an extension may do as the store held it once no change of what runs was under way. */
interface Grant {
    permissions: ReadonlySet<string>;
    // Null for an extension that is gone.
    manifest: ExtensionManifest | null;
    proposedAllowed: boolean;
    // Throws once a change of what runs came after the grant, for a side effect that follows an await of its own.
    check(): void;
}

/* What `server/` may ask the daemon, each behind the permission of the same name. */
export type ExtensionAsks = Readonly<Record<string, (...args: never[]) => Promise<unknown>>>;

interface ExtensionChatStart {
    projectId: string;
    // Where the chat works instead: the project the machine knows in this folder, which then wins over `projectId`.
    folder?: string | undefined;
    // A chat the extension draws itself with `Chat`: never on a canvas, and a view the sidebar does not list.
    hidden?: boolean | undefined;
    viewId?: string | undefined;
    beside?: string | undefined;
    provider?: string | undefined;
    title?: string | undefined;
    prompt?: string | undefined;
}

export interface ExtensionHostOptions {
    store: ExtensionStore;
    asks?: () => ExtensionAsks;
    // `check` throws once the extension was turned off, changed or removed since it was granted, so call it after every await before the chat starts.
    startChat?: (extensionId: string, start: ExtensionChatStart, check: () => void) => Promise<{ nodeId: string }>;
    runAction?: (extensionId: string, projectId: string, action: ExtensionActionName, input: unknown) => Promise<unknown>;
    terminals?: () => ExtensionTerminalPort;
    projectFiles?: () => ExtensionFilesPort;
    problems?: () => ExtensionProblemsPort;
    // A launch source said its list changed, through the `changed` of its `watch`.
    launchesChanged?: (extensionId: string, source: string, projectId: string) => void;
    // What an extension supplies may differ from here on: it was turned on or off, changed, removed, or its process ended by itself.
    providersChanged?: (extensionId: string) => void;
    addLanguageServer?: (extensionId: string, server: object) => Promise<void>;
    // Stops what runs of them also when the change cannot be saved, and then rejects.
    removeLanguageServers?: (extensionId: string) => Promise<void>;
    // The extensions that own a saved language server, so one that is gone or turned off loses them at the next start.
    languageServerOwners?: () => readonly string[];
    now?: () => number;
    spawnProcess?: typeof spawn;
    files?: ExtensionHostFiles;
    // The folders of the checkout that hold Ruimte's own development extensions; none in a compiled daemon.
    developmentRoots?: readonly string[];
}

/* The files a start, a storage write and a log touch, handed in so a test can hold each step. */
export interface ExtensionHostFiles {
    mkdir(folder: string): Promise<unknown>;
    readText(file: string): Promise<string>;
    write(file: string, text: string, mode?: number): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    append(file: string, text: string | Uint8Array): Promise<void>;
}

const NODE_FILES: ExtensionHostFiles = {
    mkdir: (folder) => mkdir(folder, { recursive: true }),
    readText: (file) => readFile(file, 'utf8'),
    write: (file, text, mode) => writeFile(file, text, mode === undefined ? {} : { mode }),
    rename,
    append: (file, text) => appendFile(file, text)
};

/*
 * Runs each extension's `server/` as a process of its own, as the person who runs the machine: a crash
 * stays out of the daemon and its sessions. It starts on the first call, or with the machine for
 * `autostart`. After three crashes in a row, with no call answered between them, it stays down until a person turns it on again.
 *
 * Stopping one is the host's to do, unlike a person's own processes: it started this one and nothing
 * else depends on it.
 */
export class ExtensionHost {
    private readonly running = new Map<string, Running>();
    private readonly starting = new Map<string, Starting>();
    private readonly storageWrites = new Map<string, Promise<unknown>>();
    private readonly crashes = new Map<string, number>();
    private readonly sinks = new ClientSinks();
    private readonly tools = new Map<string, { description: string; parameters: unknown }>();
    private readonly lifecycles = new Map<string, Promise<void>>();
    // Moves with every stop, so a start that read the store before one knows to read it again.
    private readonly generations = new Map<string, number>();
    // A process that was stopped and has not exited yet, which a new one of the same extension waits for.
    private readonly exiting = new Map<string, Promise<void>>();
    // Extensions whose folder is on its way out, which no storage write may make again.
    private readonly removing = new Set<string>();

    private readonly options: ExtensionHostOptions;
    private readonly files: ExtensionHostFiles;
    private readonly sends: SendLimit;

    constructor(options: ExtensionHostOptions) {
        this.options = options;
        this.files = options.files ?? NODE_FILES;
        this.sends = new SendLimit(() => (options.now ?? Date.now)());
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    private changed(): void {
        this.sinks.emit({ event: 'extension.changed', payload: {} });
    }

    async startAutostarted(): Promise<void> {
        let listed: (StoredExtension | DamagedExtension)[];

        try {
            listed = await this.options.store.list();
        } catch (e) {
            // An index that cannot be read says nothing of what is installed, so every saved language server stays.
            console.warn(`No extension started with the machine: ${errorText(e)}`);

            return;
        }

        // One whose files cannot be read runs nothing, and keeps its saved language servers until a person fixes or removes it.
        const extensions = listed.flatMap((entry) => (isDamaged(entry) ? [] : [entry]));
        const damaged = listed.flatMap((entry) => (isDamaged(entry) ? [entry.id] : []));
        const kept = new Set([...damaged, ...extensions.filter((extension) => extension.enabled).map((extension) => extension.manifest.id)]);

        // Turned off or removed while its language servers could not be taken off the list, or by a Ruimte that kept them.
        for (const owner of new Set(this.options.languageServerOwners?.() ?? [])) {
            if (!kept.has(owner)) {
                await this.dropLanguageServers(owner).catch((e: unknown) => console.warn(errorText(e)));
            }
        }

        for (const extension of extensions) {
            // A tool only exists once its process said so, and an agent cannot ask for what it does not see.
            if (extension.enabled && startsWithMachine(extension.manifest)) {
                await this.runningFor(extension.manifest.id).catch((e: unknown) =>
                    console.warn(`Extension ${extension.manifest.id} did not start: ${errorText(e)}`)
                );
            }
        }
    }

    statusOf(extension: StoredExtension): ExtensionStatus {
        if (!extension.enabled) {
            return 'disabled';
        }
        if ((this.crashes.get(extension.manifest.id) ?? 0) >= MAX_CRASHES) {
            return 'crashed';
        }

        return this.running.has(extension.manifest.id) ? 'running' : 'idle';
    }

    async list(): Promise<ExtensionInfo[]> {
        const extensions = await this.options.store.list();

        return extensions.map((extension) => (isDamaged(extension) ? damagedInfo(extension) : this.infoOf(extension)));
    }

    private provenanceOf(extension: StoredExtension) {
        return extensionProvenance(extension, this.options.developmentRoots ?? []);
    }

    /*
     * Why an extension whose files are fine does not run here: it names or uses a proposed part and a person installed
     * it. Decided on where the machine knows it came from, so a manifest cannot talk its way past it.
     */
    private refusedReason(extension: StoredExtension): string | null {
        return proposedRefusal(extension.manifest, this.provenanceOf(extension));
    }

    private infoOf(extension: StoredExtension): ExtensionInfo {
        const refused = this.refusedReason(extension);

        return {
            ...(refused === null ? {} : { refused }),
            manifest: extension.manifest,
            hash: extension.hash,
            enabled: extension.enabled,
            hasServer: this.options.store.serverEntry(extension) !== null,
            hasClient: existsSync(join(extension.folder, 'client', 'index.js')),
            status: this.statusOf(extension),
            provenance: this.provenanceOf(extension),
            ...(extension.devFolder === undefined ? {} : { devFolder: extension.devFolder, revision: extension.revision ?? 0 })
        };
    }

    async call(id: string, method: string, args: unknown[]): Promise<unknown> {
        const running = await this.runningFor(id);

        return this.send(running, { type: 'call', method, args }, `${id}.${method}`);
    }

    /* What an agent reads of an extension's node along a line. An extension without a reader has nothing to say. */
    async nodeContext(id: string, node: string, data: unknown): Promise<unknown> {
        const running = await this.runningFor(id);

        return this.send(running, { type: 'nodeContext', node, data }, `${id} context`);
    }

    /* Hands a machine event to every running extension that asked for it, as much of it as `ServerEvents` says. */
    forwardEvent(name: string, payload: unknown): void {
        const listeners = [...this.running.values()].filter((running) => running.subscriptions.has(name));
        const heard = listeners.length === 0 ? null : eventPayload(name, payload);

        if (heard === null) {
            return;
        }

        const line = `${JSON.stringify({ type: 'event', name, payload: heard })}\n`;

        for (const running of listeners) {
            running.child.stdin.write(line);
        }
    }

    setEnabled(id: string, enabled: boolean): Promise<void> {
        return this.commit(
            id,
            async (saved) => {
                await this.options.store.setEnabled(id, enabled);
                saved();
                this.crashes.delete(id);
                this.stop(id);

                if (!enabled) {
                    await this.dropLanguageServers(id);
                }
            },
            enabled ? () => this.startAfterChange(id) : undefined
        );
    }

    /*
     * `change` in the lifecycle of `id`, and once it called `saved` the store has it: `after` runs and every client hears
     * of it, also when the cleanup between them failed. That failure is then the answer, so a person hears what stayed.
     */
    private async commit(id: string, change: (saved: () => void) => Promise<void>, after?: () => Promise<void>): Promise<void> {
        let saved = false;
        let failure: { error: unknown } | null = null;

        try {
            await this.lifecycle(id, () => change(() => (saved = true)));
        } catch (e) {
            if (!saved) {
                throw e;
            }

            failure = { error: e };
        }

        if (!saved) {
            return;
        }

        try {
            await after?.();
        } finally {
            this.changed();
            this.options.providersChanged?.(id);
        }

        if (failure !== null) {
            throw failure.error;
        }
    }

    /* Their processes stop either way; a list that could not be saved without them rejects, so a person hears it. */
    private async dropLanguageServers(id: string): Promise<void> {
        try {
            await this.options.removeLanguageServers?.(id);
        } catch (e) {
            throw new ExtensionRefusal('failed', `The language servers of ${id} stopped, but they stay saved: ${errorText(e)}`);
        }
    }

    /*
     * After what runs changed: one that runs with the machine starts again, and so does one with `languages.servers`,
     * since its language servers left with the change and only its own process adds them again.
     */
    private async startAfterChange(id: string): Promise<void> {
        const extension = await this.options.store.get(id);

        if (extension === null || !extension.enabled) {
            return;
        }

        if (startsWithMachine(extension.manifest)) {
            await this.runningFor(id);
        } else if (permissionsOf(extension.manifest).has('languages.servers')) {
            await this.runningFor(id).catch((e: unknown) => console.warn(`Extension ${id} did not start: ${errorText(e)}`));
        }
    }

    /* A stop, and the language servers of what ran: a new version or the installed one under a dev link may not add them. */
    private async replace(id: string): Promise<void> {
        this.crashes.delete(id);
        this.stop(id);
        await this.dropLanguageServers(id);
    }

    async install(pack: string): Promise<ExtensionInfo> {
        const { id } = manifestOfPack(pack);

        await this.commit(
            id,
            async (saved) => {
                await this.options.store.install(pack);
                saved();
                await this.replace(id);
            },
            () => this.startAfterChange(id)
        );

        return (await this.list()).find((entry) => entry.manifest.id === id) as ExtensionInfo;
    }

    /*
     * Its folder goes only once nothing can write into it again: no process of it, no start on its way, and no storage
     * write, of which none begins while it goes.
     */
    remove(id: string): Promise<void> {
        return this.commit(id, async (saved) => {
            const starting = this.starting.get(id)?.promise;

            this.removing.add(id);

            try {
                this.stop(id);
                await starting?.catch(() => undefined);

                for (let exiting = this.exiting.get(id); exiting !== undefined; exiting = this.exiting.get(id)) {
                    await exiting;
                }

                for (let write = this.storageWrites.get(id); write !== undefined; write = this.storageWrites.get(id)) {
                    await write.catch(() => undefined);
                }

                await this.options.store.remove(id);
                saved();
                this.crashes.delete(id);
                await this.dropLanguageServers(id);
            } finally {
                this.removing.delete(id);
            }
        });
    }

    /*
     * A save in dev: a fresh process over what was just built, and word so a client loads it again. The link and the
     * run it is `owner`'s are one change of the store, so an unlink of another run never comes between them.
     */
    async linked(folder: string, owner?: string, startsOff = false): Promise<string> {
        const { id } = await this.options.store.link(folder, owner, startsOff);

        await this.commit(
            id,
            async (saved) => {
                saved();
                await this.replace(id);
            },
            // As with the machine: one with a clock or a tool does nothing until it runs. Its log says why a build does not start.
            () => this.startAfterChange(id).catch((e: unknown) => console.warn(`Extension ${id} did not start: ${errorText(e)}`))
        );

        return id;
    }

    /*
     * What was installed under the link runs again as it would have without it. With `owner`, only while the link is
     * still that run's: a later `extension dev` of the same extension took it over.
     */
    unlink(id: string, owner?: string): Promise<void> {
        return this.commit(
            id,
            async (saved) => {
                if (await this.options.store.unlink(id, owner)) {
                    saved();
                    await this.replace(id);
                }
            },
            () => this.startAfterChange(id).catch((e: unknown) => console.warn(`Extension ${id} did not start: ${errorText(e)}`))
        );
    }

    /*
     * One change of what an extension runs at a time: turning it on or off, a new version, its removal, and a language server
     * its process adds. A start waits for one under way, so it never reads the store from before the change.
     */
    private lifecycle<Value>(id: string, work: () => Promise<Value>): Promise<Value> {
        const next = (this.lifecycles.get(id) ?? Promise.resolve()).then(work, work);
        const settled = next.then(
            () => undefined,
            () => undefined
        );

        this.lifecycles.set(id, settled);
        void settled.then(() => {
            if (this.lifecycles.get(id) === settled) {
                this.lifecycles.delete(id);
            }
        });

        return next;
    }

    /*
     * The same file `storage` in `server/` writes, so both ends of an extension read one truth. Only a file that is not
     * there is empty: a write over one that could not be read would keep the new key and lose every other.
     */
    private async storageOf(id: string): Promise<{ file: string; values: Record<string, unknown> }> {
        const file = join(this.options.store.dataFolder(id), 'storage.json');
        let text: string;

        try {
            text = await this.files.readText(file);
        } catch (e) {
            if (isNotFound(e)) {
                return { file, values: {} };
            }

            throw new ExtensionRefusal('failed', `The storage of ${id} could not be read: ${errorText(e)}`);
        }

        const values = parseKeyValues(text);

        if (values === null) {
            throw new ExtensionRefusal('failed', `The storage of ${id} is damaged, so nothing is read or written until ${file} is fixed or removed`);
        }

        return { file, values };
    }

    /* After the writes asked for before it, so a read follows what its own side just set. */
    async storageGet(id: string, key: string): Promise<unknown> {
        await bestEffort('storageWrites.get', this.storageWrites.get(id));

        return ownValue((await this.storageOf(id)).values, key);
    }

    storageSet(id: string, key: string, value: unknown): Promise<void> {
        return this.changeStorage(id, key, (values) => ({ ...values, [key]: value }));
    }

    storageDelete(id: string, key: string): Promise<void> {
        return this.changeStorage(id, key, ({ [key]: _gone, ...rest }) => rest);
    }

    /*
     * One write per extension at a time, each over what the last one left, so two keys set at once both stay. The only
     * writer of `storage.json`: its process asks here too. Every client hears the key once the file has it, so a window
     * that read it before never keeps, or writes back, an older value.
     */
    private changeStorage(id: string, key: string, change: (values: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
        if (this.removing.has(id)) {
            return Promise.reject(new ExtensionRefusal('unavailable', `${id} is being removed`));
        }

        const write = async (): Promise<void> => {
            const { file, values } = await this.storageOf(id);
            const temporary = `${file}.${process.pid}.tmp`;
            const next = change(values);

            await this.files.mkdir(dirname(file));
            await this.files.write(temporary, JSON.stringify(next), 0o600);
            await this.files.rename(temporary, file);

            const value = ownValue(next, key);

            this.sinks.emit({ event: 'extension.storageChanged', payload: value === undefined ? { id, key } : { id, key, value } });
        };
        const next = (this.storageWrites.get(id) ?? Promise.resolve()).then(write, write);

        this.storageWrites.set(id, next);
        void next.then(
            () => this.forgetWrite(id, next),
            () => this.forgetWrite(id, next)
        );

        return next;
    }

    private forgetWrite(id: string, write: Promise<unknown>): void {
        if (this.storageWrites.get(id) === write) {
            this.storageWrites.delete(id);
        }
    }

    agentTools(): readonly { id: string; description: string; parameters: unknown }[] {
        return [...this.tools.entries()].map(([id, tool]) => ({ id, ...tool }));
    }

    /* An agent's call of a tool. It answers in text, as anything an agent reads does. */
    async runAgentTool(tool: string, input: unknown, context: { caller: string }): Promise<string> {
        const slash = tool.indexOf('/');

        if (slash === -1 || !this.tools.has(tool)) {
            throw new ToolRefusal('no-tool', `No tool ${tool}. tool_list says what there is`);
        }

        const id = tool.slice(0, slash);
        const running = await this.runningFor(id);
        const answer = await this.send(running, { type: 'tool', method: tool.slice(slash + 1), payload: input, context }, tool);

        return typeof answer === 'string' ? answer : JSON.stringify(answer);
    }

    /* What a client of an extension in development says. Nothing keeps it for one that is installed. */
    async appendDevLog(id: string, text: string): Promise<void> {
        const extension = await this.options.store.get(id);

        if (extension?.devFolder === undefined) {
            return;
        }

        const file = this.options.store.logFile(id);

        await this.files.mkdir(dirname(file));
        await this.files.append(file, `${text}\n`);
    }

    stopAll(): void {
        for (const id of new Set([...this.running.keys(), ...this.starting.keys()])) {
            this.stop(id);
        }
    }

    private forgetTools(id: string): void {
        for (const tool of this.tools.keys()) {
            if (tool.startsWith(`${id}/`)) {
                this.tools.delete(tool);
            }
        }
    }

    private stop(id: string): void {
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1);

        const starting = this.starting.get(id);

        if (starting !== undefined) {
            starting.attempt.cancelled = true;
            this.starting.delete(id);
        }

        const running = this.running.get(id);

        if (running === undefined) {
            return;
        }

        running.stopping = true;
        running.child.kill();

        // One that holds on to SIGTERM would keep every later start of it waiting.
        const forced = setTimeout(() => running.child.kill('SIGKILL'), KILL_AFTER_MS);
        const exiting = running.ended.then(() => {
            clearTimeout(forced);

            if (this.exiting.get(id) === exiting) {
                this.exiting.delete(id);
            }
        });

        forced.unref();
        this.exiting.set(id, exiting);
        this.running.delete(id);
        this.forgetTools(id);
        this.forgetHeld(id);
        this.failPending(running, stopped());
    }

    /* What the machine held for a process that is gone: the files it followed and the problems it reported. */
    private forgetHeld(id: string): void {
        this.options.projectFiles?.().unwatchAll(id);
        this.options.problems?.().drop(id);
    }

    private async runningFor(id: string): Promise<Running> {
        const running = this.running.get(id);

        if (running !== undefined) {
            await running.ready;

            return running;
        }

        await this.lifecycles.get(id);

        const generation = this.generations.get(id);
        const extension = await this.options.store.get(id);

        // A stop or a change while the store answered makes what it said old: read it again once the change is done.
        if (this.generations.get(id) !== generation || this.lifecycles.has(id)) {
            return this.runningFor(id);
        }

        if (extension === null) {
            throw new ExtensionRefusal('not-found', `No extension ${id} on this machine`);
        }

        if (!extension.enabled) {
            throw new ExtensionRefusal('unavailable', `${id} is turned off`);
        }

        if ((this.crashes.get(id) ?? 0) >= MAX_CRASHES) {
            throw new ExtensionRefusal('unavailable', `${id} crashed ${MAX_CRASHES} times in a row and stays off until a person turns it on again`);
        }

        const refused = this.refusedReason(extension);

        if (refused !== null) {
            throw new ExtensionRefusal('unavailable', refused);
        }

        return this.start(extension);
    }

    /* One process per extension: a second start while the first is on its way waits for that one. */
    private start(extension: StoredExtension): Promise<Running> {
        const { id } = extension.manifest;
        const starting = this.starting.get(id);

        if (starting !== undefined) {
            return starting.promise;
        }

        const running = this.running.get(id);

        if (running !== undefined) {
            return running.ready.then(() => running);
        }

        const attempt = { cancelled: false };
        const promise = this.spawnFor(extension, attempt).finally(() => {
            if (this.starting.get(id)?.attempt === attempt) {
                this.starting.delete(id);
            }
        });

        this.starting.set(id, { promise, attempt });

        return promise;
    }

    private async spawnFor(extension: StoredExtension, attempt: Starting['attempt']): Promise<Running> {
        const { store, spawnProcess = spawn } = this.options;
        const { id } = extension.manifest;
        const entry = store.serverEntry(extension);

        if (entry === null) {
            throw new ExtensionRefusal('not-found', `${id} has no server part`);
        }

        // The last one is gone first, so two never share the data folder or answer as one.
        for (let exiting = this.exiting.get(id); exiting !== undefined; exiting = this.exiting.get(id)) {
            await exiting;
        }

        if (attempt.cancelled) {
            throw stopped();
        }

        const dataFolder = store.dataFolder(id);
        const runtimePath = join(dataFolder, '.runtime', RUNTIME_FILE);

        await this.files.mkdir(dirname(runtimePath));
        await this.files.write(runtimePath, runtimeSource);

        if (attempt.cancelled) {
            throw stopped();
        }

        const runtime = bunRuntime();
        const proposedAllowed = allowsProposed(this.provenanceOf(extension));
        const child = spawnProcess(runtime.command, [...runtime.args, runtimePath, entry, dataFolder], {
            cwd: dataFolder,
            env: {
                ...process.env,
                ...runtime.env,
                RUIMTE_EXTENSION_ID: id,
                RUIMTE_EXTENSION_PERMISSIONS: JSON.stringify(Object.keys(extension.manifest.permissions ?? {})),
                RUIMTE_EXTENSION_PROVIDES: JSON.stringify({ provides: extension.manifest.provides ?? {}, proposed: extension.manifest.proposed ?? [] }),
                RUIMTE_EXTENSION_PROPOSED: proposedAllowed ? '1' : '0'
            },
            stdio: 'pipe'
        }) as ChildProcessWithoutNullStreams;
        const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers<void>();
        const { promise: ended, resolve: end } = Promise.withResolvers<void>();
        // One that hangs while it loads would otherwise hold every call to it for good.
        const startTimer = setTimeout(() => this.stop(id), ANSWER_TIMEOUT_MS);
        const markReady = (): void => {
            clearTimeout(startTimer);
            resolveReady();
        };
        const running: Running = {
            child,
            ready,
            failStart: (reason) => {
                clearTimeout(startTimer);
                rejectReady(reason);
            },
            pending: new Map(),
            permissions: new Set(Object.keys(extension.manifest.permissions ?? {})),
            manifest: extension.manifest,
            proposedAllowed,
            profiles: new Map(),
            launchSources: new Map(),
            problemSources: new Map(),
            machineSources: new Map(),
            machineReports: new Map(),
            notificationChannels: new Map(),
            subscriptions: new Set(),
            nextCall: 1,
            buffered: '',
            stopping: false,
            ended
        };

        // A stop while nobody waits on the start is no failure of anyone's.
        ready.catch(() => undefined);
        this.running.set(id, running);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.read(id, running, chunk, markReady));
        child.stderr.on('data', (chunk: Buffer) => {
            void bestEffort('files.append', this.files.append(store.logFile(id), chunk));
        });
        // A pipe that breaks with the process says so here; the exit below is what acts on it.
        child.stdin.on('error', () => undefined);
        // A process that could not start ends with an error and no exit.
        child.on('error', (e) => {
            end();
            this.exited(id, running, new ExtensionRefusal('unavailable', errorText(e)));
        });
        child.on('exit', () => {
            end();
            this.exited(id, running, stopped());
        });
        this.changed();
        await running.ready;

        return running;
    }

    private read(id: string, running: Running, chunk: string, markReady: () => void): void {
        running.buffered += chunk;

        for (let end = running.buffered.indexOf('\n'); end >= 0; end = running.buffered.indexOf('\n')) {
            const line = running.buffered.slice(0, end);

            running.buffered = running.buffered.slice(end + 1);
            this.handle(id, running, line, markReady);
        }
    }

    private handle(id: string, running: Running, line: string, markReady: () => void): void {
        const message = protocolMessage(line);

        // A process that was stopped can still have lines in the pipe; nothing it asks or says counts any more.
        if (this.running.get(id) !== running) {
            return;
        }

        // Its own code can still write to stdout around the console, and a line that is no message is only noise.
        if (message === null) {
            void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${line}\n`));

            return;
        }

        if (message.type === 'ask') {
            void this.answerAsk(id, running, message.method, message.args).then(
                (result) => running.child.stdin.write(`${JSON.stringify({ type: 'answer', id: message.id, result: result ?? null })}\n`),
                (e: unknown) => {
                    const { code, message: reason } = extensionFailureOf(e);

                    // A refusal answers as a Result, so the terminal of `extension dev` is where a person still sees it.
                    void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${message.method} answered ${code}: ${reason}\n`));
                    running.child.stdin.write(`${JSON.stringify({ type: 'answer', id: message.id, error: reason, code })}\n`);
                }
            );
        } else if (message.type === 'tool') {
            // The permissions it started with, read at once, so a stop cannot come between and leave the tool listed.
            if (running.permissions.has('agents.tools')) {
                this.tools.set(`${id}/${message.name}`, { description: message.description, parameters: message.parameters });
            }
        } else if (message.type === 'ready') {
            // Loading proves nothing: one that loads and dies on every call would never count three in a row.
            markReady();
        } else if (message.type === 'subscribe') {
            this.followEvent(id, running, message.name);
        } else if (message.type === 'profile') {
            this.defineProfile(id, running, message);
        } else if (message.type === 'launchSource') {
            if (this.mayProvide(id, running, 'defineLaunchSource', 'launches.provide', message.id)) {
                running.launchSources.set(message.id, { title: message.title, watches: message.watches });
            }
        } else if (message.type === 'problemSource') {
            if (this.mayProvide(id, running, 'defineProblemSource', 'problems.provide', message.id)) {
                running.problemSources.set(message.id, { title: message.title });
            }
        } else if (message.type === 'machineSource') {
            if (this.mayProvide(id, running, 'defineMachineSource', 'machines.provide', message.id)) {
                running.machineSources.set(message.id, { title: message.title });
            }
        } else if (message.type === 'notificationChannel') {
            if (this.mayProvide(id, running, 'defineNotificationChannel', 'notifications.provide', message.id)) {
                running.notificationChannels.set(message.id, { title: message.title });
            }
        } else if (message.type === 'machineReport') {
            running.machineReports.get(message.run)?.(message.line);
        } else if (message.type === 'launchesChanged') {
            if (running.launchSources.has(message.source)) {
                this.options.launchesChanged?.(id, message.source, message.projectId);
            }
        } else if (message.type === 'emit') {
            this.sinks.emit({ event: 'extension.message', payload: { id, name: message.name, payload: message.payload } });
        } else {
            const pending = running.pending.get(message.id);

            if (pending !== undefined) {
                running.pending.delete(message.id);
                clearTimeout(pending.timer);

                if (message.error === undefined) {
                    this.crashes.delete(id);
                    pending.resolve(message.result);
                } else {
                    pending.reject(new ExtensionRefusal(message.code === 'not-found' ? 'not-found' : 'failed', message.error));
                }
            }
        }
    }

    private followEvent(id: string, running: Running, name: string): void {
        const reason = eventRefusal(name, running.permissions);

        if (reason === null) {
            running.subscriptions.add(name);

            return;
        }

        void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${reason}\n`));
    }

    /* The process's own runtime refuses the same, so this only meets one that speaks the pipe by hand. */
    private mayProvide(id: string, running: Running, define: string, permission: string, provided: string): boolean {
        const refused =
            missingPermission(id, permission, running.permissions)?.message ?? providerRefusal(running.manifest, define, provided, running.proposedAllowed);

        if (refused === null) {
            return true;
        }

        void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${refused}\n`));

        return false;
    }

    private defineProfile(id: string, running: Running, profile: DefinedProfile & { id: string }): void {
        if (this.mayProvide(id, running, 'defineTerminalProfile', 'terminals.profiles', profile.id)) {
            running.profiles.set(profile.id, { title: profile.title, icon: profile.icon, available: profile.available });
        }
    }

    /*
     * What the launch sources of this machine's extensions list in a project. A source is its extension's process, so
     * that starts for the list, as a terminal profile's does for a pick. One that does not start, fails or answers
     * another shape lists nothing, and its log says why.
     */
    async launchSources(project: ExtensionProject): Promise<SourceListing[]> {
        const listings: SourceListing[] = [];

        for (const extension of await this.options.store.list()) {
            if (isDamaged(extension) || !extension.enabled || this.refusedReason(extension) !== null || this.options.store.serverEntry(extension) === null) {
                continue;
            }

            const { id } = extension.manifest;
            const ids = providedIds(extension.manifest, 'launchSources', allowsProposed(this.provenanceOf(extension)));

            if (ids.length === 0) {
                continue;
            }

            try {
                const running = await this.runningFor(id);

                for (const source of ids) {
                    const defined = running.launchSources.get(source);

                    if (defined !== undefined) {
                        listings.push({ extension: id, source, ...defined, launches: await this.launchesOf(id, running, source, project) });
                    }
                }
            } catch (e) {
                void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `Its launches were not listed: ${errorText(e)}\n`));
            }
        }

        return listings;
    }

    private async launchesOf(id: string, running: Running, source: string, project: ExtensionProject): Promise<LaunchDescription[]> {
        const answer = await this.send(running, { type: 'launchSource', source, method: 'list', input: project }, `${id} launch source ${source}`);

        return launchesListed(answer, (reason) => {
            void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${source} ${reason}\n`));
        });
    }

    /* Has a launch source that runs tell when its list changed in a project, or stop telling. Starts no process for either. */
    async watchLaunchSource(id: string, source: string, project: ExtensionProject, watch: boolean): Promise<void> {
        const running = this.running.get(id);

        if (running?.launchSources.get(source)?.watches === true) {
            await this.send(running, { type: 'launchSource', source, method: watch ? 'watch' : 'unwatch', input: project }, `${id} launch source ${source}`);
        }
    }

    /*
     * The places the machine sources of this machine's extensions list in a project, by the rules of `launchSources`: a
     * source's process starts for the list, and one that fails or answers another shape lists nothing.
     */
    async machineSources(project: ExtensionProject): Promise<MachineSourceListing[]> {
        const listings: MachineSourceListing[] = [];

        for (const extension of await this.options.store.list()) {
            if (isDamaged(extension) || !extension.enabled || this.refusedReason(extension) !== null || this.options.store.serverEntry(extension) === null) {
                continue;
            }

            const { id } = extension.manifest;
            const ids = providedIds(extension.manifest, 'machineSources', allowsProposed(this.provenanceOf(extension)));

            if (ids.length === 0) {
                continue;
            }

            try {
                const running = await this.runningFor(id);

                for (const source of ids) {
                    const defined = running.machineSources.get(source);

                    if (defined === undefined) {
                        continue;
                    }

                    const answer = await this.send(
                        running,
                        { type: 'machineSource', source, method: 'list', input: { project } },
                        `${id} machine source ${source}`
                    );
                    const candidates = candidatesListed(answer, (reason) => {
                        void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${source} ${reason}\n`));
                    });

                    listings.push({ extension: id, source, title: defined.title, candidates });
                }
            } catch (e) {
                void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `Its machines were not listed: ${errorText(e)}\n`));
            }
        }

        return listings;
    }

    /*
     * Asks a machine source what starts a machine in one of its places. `report` hears the lines it says meanwhile, and
     * an aborted `signal` aborts the one the source was handed. The answer is a description only: nothing ran yet.
     */
    async machineStart(
        id: string,
        source: string,
        project: ExtensionProject,
        candidate: MachineCandidateDescription,
        hooks: { report(line: string): void; signal: AbortSignal }
    ): Promise<MachineStartDescription> {
        const running = this.running.get(id);

        if (running?.machineSources.has(source) !== true) {
            throw new ExtensionRefusal('not-found', `${id} supplies no machine source ${source}`);
        }

        // The number its reports and an abort go under, which is the one `send` takes for the ask itself.
        const run = running.nextCall;
        const abort = (): void => void running.child.stdin.write(`${JSON.stringify({ type: 'machineAbort', run })}\n`);

        running.machineReports.set(run, hooks.report);
        hooks.signal.addEventListener('abort', abort);

        try {
            const input = { project, candidate, run };
            const asked = this.send(running, { type: 'machineSource', source, method: 'start', input }, `${id} machine source ${source}`);

            // A stop from before the ask still reaches the source, after the ask it is about.
            if (hooks.signal.aborted) {
                abort();
            }

            return machineStartDescribed(await asked);
        } catch (e) {
            throw e instanceof ExtensionRefusal ? e : new ExtensionRefusal('failed', errorText(e));
        } finally {
            running.machineReports.delete(run);
            hooks.signal.removeEventListener('abort', abort);
        }
    }

    /*
     * The terminal profiles the extensions of this machine supply, from their manifests, so the menu of a new terminal
     * lists one before its `server/` ran. A process that runs is asked whether its profile shows in this project, and
     * names it; one that does not run is not started for a list.
     */
    async terminalProfiles(project: ExtensionProject): Promise<ExtensionTerminalProfile[]> {
        const listed = await this.options.store.list();
        const profiles: ExtensionTerminalProfile[] = [];

        for (const extension of listed) {
            if (isDamaged(extension) || !extension.enabled || this.refusedReason(extension) !== null || this.options.store.serverEntry(extension) === null) {
                continue;
            }

            const { id, name } = extension.manifest;
            const ids = providedIds(extension.manifest, 'terminalProfiles', allowsProposed(this.provenanceOf(extension)));
            const running = this.running.get(id);

            for (const profile of ids) {
                const defined = running?.profiles.get(profile);

                if (running !== undefined && defined?.available === true && !(await this.profileShows(id, running, profile, project))) {
                    continue;
                }

                profiles.push({
                    extension: id,
                    id: profile,
                    title: defined?.title ?? (ids.length === 1 ? name : `${name}: ${profile}`),
                    ...(defined?.icon === undefined ? {} : { icon: defined.icon })
                });
            }
        }

        return profiles;
    }

    /*
     * The notification channels the extensions of this machine supply, from their manifests, so Settings lists one
     * before its `server/` ran. A process that runs names its channel; one that does not is not started for a list.
     */
    async notificationChannels(): Promise<{ extension: string; id: string; title: string }[]> {
        const channels: { extension: string; id: string; title: string }[] = [];

        for (const extension of await this.options.store.list()) {
            if (isDamaged(extension) || !extension.enabled || this.refusedReason(extension) !== null || this.options.store.serverEntry(extension) === null) {
                continue;
            }

            const { id, name } = extension.manifest;
            const ids = providedIds(extension.manifest, 'notificationChannels', allowsProposed(this.provenanceOf(extension)));

            for (const channel of ids) {
                const title = this.running.get(id)?.notificationChannels.get(channel)?.title;

                channels.push({ extension: id, id: channel, title: title ?? (ids.length === 1 ? name : `${name}: ${channel}`) });
            }
        }

        return channels;
    }

    /*
     * Hands a channel one notification, in its extension's own process, which starts for it. Never rejects: a channel
     * that is gone, throws or does not answer in time loses this notification alone, and its log says why.
     */
    async deliverNotification(id: string, channel: string, notification: object): Promise<boolean> {
        try {
            if (!(await this.notificationChannels()).some((listed) => listed.extension === id && listed.id === channel)) {
                return false;
            }

            const running = await this.runningFor(id);

            if (!running.notificationChannels.has(channel)) {
                throw new ExtensionRefusal('not-found', `${id} lists the notification channel ${channel} and did not define it`);
            }

            await this.send(running, { type: 'notificationChannel', channel, input: notification }, `${id} notification channel ${channel}`);

            return true;
        } catch (e) {
            void bestEffort('files.append', this.files.append(this.options.store.logFile(id), `${channel} did not deliver a notification: ${errorText(e)}\n`));

            return false;
        }
    }

    /* A profile whose answer fails or never comes still shows: picking it says what is wrong. */
    private async profileShows(id: string, running: Running, profile: string, project: ExtensionProject): Promise<boolean> {
        try {
            return (await this.send(running, { type: 'profile', profile, method: 'available', input: project }, `${id} profile ${profile}`)) !== false;
        } catch {
            return true;
        }
    }

    /*
     * What a terminal profile starts, asked of the extension's own process, which starts for it. The extension only
     * describes: the session that runs the program is the machine's.
     */
    async profileSpawn(id: string, profile: string, context: { project: ExtensionProject; cwd: string }): Promise<SpawnDescription> {
        const grant = await this.grantedTo(id);

        if (grant.manifest === null) {
            throw new ExtensionRefusal('not-found', `No extension ${id} on this machine`);
        }

        refuse(terminalProfileRefusal(grant.manifest, profile, grant.proposedAllowed));

        const running = await this.runningFor(id);
        const defined = running.profiles.get(profile);

        if (defined === undefined) {
            throw new ExtensionRefusal('not-found', `${id} lists the terminal profile ${profile} and did not define it`);
        }

        if (defined.available && !(await this.profileShows(id, running, profile, context.project))) {
            throw new ExtensionRefusal('refused', `${defined.title} is not available in this project`);
        }

        const described = SpawnDescriptionSchema.safeParse(
            await this.send(running, { type: 'profile', profile, method: 'spawn', input: context }, `${id} profile ${profile}`)
        );

        if (!described.success) {
            throw new ExtensionRefusal('failed', `${defined.title} described nothing to start: ${described.error.issues[0]?.message ?? 'invalid'}`);
        }

        return described.data;
    }

    /* A terminal for a client: one its extension opens, or with `picked` one whose profile a person chose from a menu. */
    async openTerminal(id: string, start: ExtensionTerminalStart): Promise<{ nodeId: string }> {
        return this.openTerminalWith(id, await this.grantedTo(id), start);
    }

    private async openTerminalWith(id: string, grant: Grant, start: ExtensionTerminalStart): Promise<{ nodeId: string }> {
        // A person's own pick asks nothing of the extension but the profile itself.
        if (start.picked !== true) {
            refuse(missingPermission(id, 'canvas.write', grant.permissions));
        }

        if (start.profile !== undefined) {
            if (grant.manifest === null) {
                throw new ExtensionRefusal('not-found', `No extension ${id} on this machine`);
            }

            refuse(terminalProfileRefusal(grant.manifest, start.profile, grant.proposedAllowed));
        } else if (start.picked === true) {
            throw new ExtensionRefusal('invalid-input', 'A person picks a profile, so the terminal names one');
        }

        return this.terminalPort().open(id, start, grant.check);
    }

    /* Typed only into a terminal this extension opened, which the port decides on the machine's own record. */
    async writeTerminal(id: string, nodeId: string, text: string): Promise<void> {
        return this.writeTerminalWith(id, await this.grantedTo(id), nodeId, text);
    }

    private async writeTerminalWith(id: string, grant: Grant, nodeId: string, text: string): Promise<void> {
        refuse(missingPermission(id, 'terminals.write', grant.permissions));
        await this.terminalPort().write(id, nodeId, text);
    }

    private terminalPort(): ExtensionTerminalPort {
        const port = this.options.terminals?.();

        if (port === undefined) {
            throw new ExtensionRefusal('unavailable', 'This machine opens no terminals for an extension');
        }

        return port;
    }

    /* Whoever asks, client or `server/`: a chat the person sees, behind the same permission. */
    async startAgent(id: string, start: ExtensionChatStart): Promise<{ nodeId: string }> {
        return this.startChatWith(id, await this.grantedTo(id), start);
    }

    private async startChatWith(id: string, grant: Grant, start: ExtensionChatStart): Promise<{ nodeId: string }> {
        refuse(missingPermission(id, 'agents.start', grant.permissions));

        if (this.options.startChat === undefined) {
            throw new ExtensionRefusal('unavailable', 'This machine does not start chats for an extension');
        }

        return this.options.startChat(id, start, grant.check);
    }

    /* An action of the machine, within the list and the manifest. Both checked here, so the client's own check is only a courtesy. */
    async runAction(id: string, projectId: string, action: string, input: unknown): Promise<unknown> {
        return this.runActionWith(id, await this.grantedTo(id), projectId, action, input);
    }

    private async runActionWith(id: string, grant: Grant, projectId: string, action: string, input: unknown): Promise<unknown> {
        refuse(actionRefusal(id, action, grant.permissions));

        if (this.options.runAction === undefined) {
            throw new ExtensionRefusal('unavailable', 'This machine does not run actions for an extension');
        }

        // `actionRefusal` let through only a name of `EXTENSION_ACTIONS`.
        return this.options.runAction(id, projectId, action as ExtensionActionName, input);
    }

    /*
     * What the manifest asks for as it is stored once no change of what runs is under way, so an update that drops a
     * permission takes it away at once, and nothing for one that is turned off. A store read that a change came between
     * is read again, as `runningFor` does. With `running`, also nothing once that process is no longer the one that runs:
     * an ask that came in before a turn off is not answered after it.
     */
    private async grantedTo(id: string, running?: Running): Promise<Grant> {
        await this.lifecycles.get(id);

        const generation = this.generations.get(id);
        const extension = await this.options.store.get(id);

        if (this.generations.get(id) !== generation || this.lifecycles.has(id)) {
            return this.grantedTo(id, running);
        }

        const check = (): void => {
            if (running !== undefined && this.running.get(id) !== running) {
                throw stopped();
            }

            // Every change of what runs stops it, which moves the generation.
            if (this.generations.get(id) !== generation) {
                throw new ExtensionRefusal('unavailable', `${id} changed while it asked`);
            }
        };

        check();

        if (extension?.enabled === false) {
            throw new ExtensionRefusal('unavailable', `${id} is turned off`);
        }

        const refused = extension === null ? null : this.refusedReason(extension);

        if (refused !== null) {
            throw new ExtensionRefusal('unavailable', refused);
        }

        return {
            permissions: permissionsOf(extension?.manifest),
            manifest: extension?.manifest ?? null,
            proposedAllowed: extension !== null && allowsProposed(this.provenanceOf(extension)),
            check
        };
    }

    /* What a client with no shell of its own loads. Not its server part, which only runs here. */
    async clientFiles(id: string): Promise<{ hash: string; files: Record<string, string> }> {
        const extension = await this.options.store.get(id);

        if (extension === null) {
            throw new ExtensionRefusal('not-found', `No extension ${id} on this machine`);
        }

        return { hash: extension.hash, files: await clientFilesOf(extension.folder, extension.manifest) };
    }

    private async answerAsk(id: string, running: Running, method: string, args: unknown[]): Promise<unknown> {
        const grant = await this.grantedTo(id, running);

        refuse(askRefusal(id, method, args, grant.permissions));

        if (method === 'storage.get') {
            return { value: await this.storageGet(id, String(args[0])) };
        }

        if (method === 'storage.set') {
            return this.storageSet(id, String(args[0]), args[1]);
        }

        if (method === 'storage.delete') {
            return this.storageDelete(id, String(args[0]));
        }

        if (method === 'action') {
            const [projectId, action, input] = args as [string, string, unknown];

            return this.runActionWith(id, grant, projectId, action, input);
        }

        if (method === 'languages.add') {
            const add = this.options.addLanguageServer;

            if (add === undefined) {
                throw new ExtensionRefusal('unavailable', 'This machine does not add language servers for an extension');
            }

            // Between the changes of what runs, so a turn off either waits for it and takes it away, or comes first and refuses it.
            return this.lifecycle(id, async () => {
                grant.check();

                return add(id, args[0] as object);
            });
        }

        if (method === 'agents.start') {
            return this.startChatWith(id, grant, args[0] as ExtensionChatStart);
        }

        if (method === 'terminals.open') {
            const start = TerminalOpenAskSchema.safeParse(args[0]);

            if (!start.success) {
                throw new ExtensionRefusal('invalid-input', `terminals.open takes another shape: ${start.error.issues[0]?.message ?? 'invalid'}`);
            }

            return this.openTerminalWith(id, grant, start.data);
        }

        if (method === 'terminals.write') {
            const written = TerminalWriteAskSchema.safeParse(args);

            if (!written.success) {
                throw new ExtensionRefusal('invalid-input', `terminals.write takes a terminal and text of at most ${EXTENSION_TERMINAL_TEXT_MAX} characters`);
            }

            return this.writeTerminalWith(id, grant, ...written.data);
        }

        if (method === 'terminals.read') {
            return this.terminalPort().read(String(args[0]));
        }

        if (method.startsWith('files.')) {
            return this.answerFiles(id, running, grant, method, args);
        }

        if (method === 'problems.report' || method === 'problems.clear') {
            return this.answerProblems(id, running, grant, method, args);
        }

        const run = this.options.asks?.()[method];

        if (run === undefined) {
            throw new ExtensionRefusal('unavailable', `This machine does not answer ${method}`);
        }

        if (method === 'chats.send') {
            refuse(this.sends.take(id, String(args[0])));
        }

        return (run as (...values: unknown[]) => Promise<unknown>)(...args);
    }

    private async answerFiles(id: string, running: Running, grant: Grant, method: string, args: unknown[]): Promise<unknown> {
        const port = this.options.projectFiles?.();

        if (port === undefined) {
            throw new ExtensionRefusal('unavailable', 'This machine reads no files for an extension');
        }

        if (method === 'files.unwatch') {
            port.unwatch(id, Number(args[0]));

            return null;
        }

        if (method === 'files.watch') {
            const asked = FileWatchAskSchema.safeParse(args);

            if (!asked.success) {
                throw new ExtensionRefusal('invalid-input', 'files.watch takes a project, a path and a listener');
            }

            const [projectId, path, watch] = asked.data;

            await port.watch(id, watch, projectId, path, () => {
                if (this.running.get(id) === running) {
                    running.child.stdin.write(`${JSON.stringify({ type: 'fileChanged', watch })}\n`);
                }
            });

            // The extension may have been turned off while the path was judged, after its watches were let go.
            try {
                grant.check();
            } catch (e) {
                port.unwatch(id, watch);

                throw e;
            }

            return null;
        }

        const asked = FileReadAskSchema.safeParse(args);

        if (!asked.success) {
            throw new ExtensionRefusal('invalid-input', `${method} takes a project and a path`);
        }

        return method === 'files.list' ? port.list(...asked.data) : port.readText(...asked.data);
    }

    private async answerProblems(id: string, running: Running, grant: Grant, method: string, args: unknown[]): Promise<unknown> {
        const port = this.options.problems?.();

        if (port === undefined || grant.manifest === null) {
            throw new ExtensionRefusal('unavailable', 'This machine keeps no problems for an extension');
        }

        if (method === 'problems.clear') {
            const cleared = ExtensionProblemsClearSchema.safeParse(args);

            if (!cleared.success) {
                throw new ExtensionRefusal('invalid-input', 'problems.clear takes a project and a source');
            }

            refuse(problemSourceRefusal(grant.manifest, cleared.data[1], grant.proposedAllowed));
            port.clear(id, cleared.data[1], cleared.data[0]);

            return null;
        }

        const [, , files] = args as [unknown, unknown, unknown];

        // Said as a limit and not as a wrong shape, since a linter that finds too much made no mistake in its call.
        if (Array.isArray(files) && (files.length > EXTENSION_PROBLEM_FILES || files.some((file) => tooManyProblems(file)))) {
            throw new ExtensionRefusal(
                'limit',
                `A source reports at most ${EXTENSION_PROBLEMS_PER_FILE} problems per file and ${EXTENSION_PROBLEM_FILES} files at once`
            );
        }

        const reported = ExtensionProblemsReportSchema.safeParse(args);

        if (!reported.success) {
            throw new ExtensionRefusal('invalid-input', `problems.report takes another shape: ${reported.error.issues[0]?.message ?? 'invalid'}`);
        }

        const [projectId, source, problems] = reported.data;

        refuse(problemSourceRefusal(grant.manifest, source, grant.proposedAllowed));

        const title = running.problemSources.get(source)?.title;

        if (title === undefined) {
            throw new ExtensionRefusal('not-found', `${id} lists the problem source ${source} and did not define it`);
        }

        await port.report({ extension: id, id: source, title }, projectId, problems);

        // A turn off that came between let go of what the extension reported before this landed.
        try {
            grant.check();
        } catch (e) {
            port.drop(id);

            throw e;
        }

        return null;
    }

    private send(running: Running, message: object, label: string): Promise<unknown> {
        const id = running.nextCall;

        running.nextCall += 1;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                running.pending.delete(id);
                reject(new ExtensionRefusal('timeout', `${label} did not answer in time`));
            }, ANSWER_TIMEOUT_MS);

            running.pending.set(id, { resolve, reject, timer });
            running.child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
        });
    }

    private exited(id: string, running: Running, reason: Error): void {
        this.failPending(running, reason);

        if (running.stopping || this.running.get(id) !== running) {
            return;
        }

        this.running.delete(id);
        this.forgetTools(id);
        this.forgetHeld(id);
        this.crashes.set(id, (this.crashes.get(id) ?? 0) + 1);
        this.changed();
        this.options.providersChanged?.(id);
    }

    private failPending(running: Running, reason: Error): void {
        running.failStart(reason);

        for (const pending of running.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(reason);
        }

        running.pending.clear();
    }
}
