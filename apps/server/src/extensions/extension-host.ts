import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isNotFound } from '@adecore/agents';
import type { ExtensionActionName, ExtensionInfo, ExtensionStatus } from '@ruimte/contracts';
import { z } from 'zod';
import { VerbRefusal } from '../canvas/verb.ts';
import { errorText } from '../error-text.ts';
import { bunRuntime } from '../language/runtime.ts';
// @ts-expect-error Bun hands over the file's text, so a compiled daemon carries it; TypeScript only knows the module.
import runtimeSource from './generated/server-runtime.js' with { type: 'text' };
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../sessions/manager.ts';
import {
    actionRefusal,
    askRefusal,
    eventPayload,
    eventRefusal,
    missingPermission,
    permissionsOf,
    SendLimit,
    startsWithMachine,
    type Refusal
} from './policy.ts';
import { ExtensionRefusal, extensionFailureOf } from './refusal.ts';
import { ownValue, parseKeyValues } from './server-api.ts';
import type { ExtensionStore, StoredExtension } from './store.ts';

// Under the client's 60 seconds, so a person reads this answer rather than a dropped request.
const CALL_TIMEOUT_MS = 50_000;
const MAX_CRASHES = 3;
const KILL_AFTER_MS = 5_000;
const CLIENT_FOLDERS = new Set(['client', 'assets', 'locales', 'themes', 'views']);
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
    z.object({ type: z.literal('emit'), name: z.string(), payload: z.unknown().optional() }),
    z.object({ type: z.literal('result'), id: z.number(), result: z.unknown().optional(), error: z.string().optional(), code: z.string().optional() })
]);
type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>;

/* A line of the process's stdout as a message, or null for anything else its code wrote there. */
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

/* What `server/` may ask the daemon, each behind the permission of the same name. */
export type ExtensionAsks = Readonly<Record<string, (...args: never[]) => Promise<unknown>>>;

export interface ExtensionChatStart {
    projectId: string;
    viewId?: string | undefined;
    beside?: string | undefined;
    provider?: string | undefined;
    title?: string | undefined;
    prompt?: string | undefined;
}

export interface ExtensionHostOptions {
    store: ExtensionStore;
    asks?: () => ExtensionAsks;
    startChat?: (extensionId: string, start: ExtensionChatStart) => Promise<{ nodeId: string }>;
    runAction?: (extensionId: string, projectId: string, action: ExtensionActionName, input: unknown) => Promise<unknown>;
    addLanguageServer?: (extensionId: string, server: object) => Promise<void>;
    removeLanguageServers?: (extensionId: string) => Promise<void>;
    now?: () => number;
    spawnProcess?: typeof spawn;
    files?: ExtensionHostFiles;
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
        for (const extension of await this.options.store.list()) {
            // A tool only exists once its process said so, and an agent cannot ask for what it does not see.
            if (extension.enabled && startsWithMachine(extension.manifest)) {
                await this.runningFor(extension.manifest.id).catch((e: unknown) =>
                    console.warn(`Extension ${extension.manifest.id} did not start: ${errorText(e)}`)
                );
            } else if (!extension.enabled) {
                // Turned off by a Ruimte that still kept its language servers.
                await this.dropLanguageServers(extension.manifest.id);
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

        return extensions.map((extension) => ({
            manifest: extension.manifest,
            hash: extension.hash,
            enabled: extension.enabled,
            hasServer: this.options.store.serverEntry(extension) !== null,
            hasClient: existsSync(join(extension.folder, 'client', 'index.js')),
            status: this.statusOf(extension),
            ...(extension.devFolder === undefined ? {} : { devFolder: extension.devFolder, revision: extension.revision ?? 0 })
        }));
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

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        await this.lifecycle(id, async () => {
            await this.options.store.setEnabled(id, enabled);
            this.crashes.delete(id);
            this.stop(id);

            if (!enabled) {
                await this.dropLanguageServers(id);
            }
        });

        const extension = enabled ? await this.options.store.get(id) : null;

        if (extension !== null && startsWithMachine(extension.manifest)) {
            await this.runningFor(id);
        } else if (extension !== null && permissionsOf(extension.manifest).has('languages.servers')) {
            // Its language servers left when it was turned off, and only its own process adds them again.
            await this.runningFor(id).catch((e: unknown) => console.warn(`Extension ${id} did not start: ${errorText(e)}`));
        }

        this.changed();
    }

    private async dropLanguageServers(id: string): Promise<void> {
        await this.options.removeLanguageServers?.(id).catch((e: unknown) => console.warn(`The language servers of ${id} stayed: ${errorText(e)}`));
    }

    async install(pack: string): Promise<ExtensionInfo> {
        const extension = await this.options.store.install(pack);
        const { id } = extension.manifest;

        await this.lifecycle(id, async () => {
            this.crashes.delete(id);
            this.stop(id);
        });

        if (extension.enabled && startsWithMachine(extension.manifest)) {
            await this.runningFor(id);
        }

        this.changed();

        return (await this.list()).find((entry) => entry.manifest.id === id) as ExtensionInfo;
    }

    async remove(id: string): Promise<void> {
        await this.lifecycle(id, async () => {
            this.stop(id);
            await this.options.store.remove(id);
            await this.options.removeLanguageServers?.(id);
            this.crashes.delete(id);
        });
        this.changed();
    }

    /* A save in dev: a fresh process over what was just built, and word so a client loads it again. */
    async linked(folder: string): Promise<string> {
        const { id } = await this.options.store.link(folder);

        await this.lifecycle(id, async () => {
            this.crashes.delete(id);
            this.stop(id);
        });

        const extension = await this.options.store.get(id);

        // As with the machine: one with a clock or a tool does nothing until it runs. Its log says why a build does not start.
        if (extension?.enabled === true && startsWithMachine(extension.manifest)) {
            await this.runningFor(id).catch((e: unknown) => console.warn(`Extension ${id} did not start: ${errorText(e)}`));
        }

        this.changed();

        return id;
    }

    async unlink(id: string): Promise<void> {
        await this.lifecycle(id, async () => {
            this.stop(id);
            await this.options.store.unlink(id);
        });
        this.changed();
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
        await this.storageWrites.get(id)?.catch(() => undefined);

        return ownValue((await this.storageOf(id)).values, key);
    }

    storageSet(id: string, key: string, value: unknown): Promise<void> {
        return this.changeStorage(id, (values) => ({ ...values, [key]: value }));
    }

    storageDelete(id: string, key: string): Promise<void> {
        return this.changeStorage(id, ({ [key]: _gone, ...rest }) => rest);
    }

    /*
     * One write per extension at a time, each over what the last one left, so two keys set at once both stay. The only
     * writer of `storage.json`: its process asks here too.
     */
    private changeStorage(id: string, change: (values: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
        const write = async (): Promise<void> => {
            const { file, values } = await this.storageOf(id);
            const temporary = `${file}.${process.pid}.tmp`;

            await this.files.mkdir(dirname(file));
            await this.files.write(temporary, JSON.stringify(change(values)), 0o600);
            await this.files.rename(temporary, file);
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
            throw new VerbRefusal('no-tool', `No tool ${tool}. ruimte-context tool list says what there is`);
        }

        const id = tool.slice(0, slash);
        const running = await this.runningFor(id);
        const answer = await this.send(running, { type: 'tool', method: tool.slice(slash + 1), payload: input, context }, tool);

        return typeof answer === 'string' ? answer : JSON.stringify(answer);
    }

    emitChunk(runId: string, text: string): void {
        this.sinks.emit({ event: 'extension.agentChunk', payload: { runId, text } });
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
        this.failPending(running, stopped());
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
        const child = spawnProcess(runtime.command, [...runtime.args, runtimePath, entry, dataFolder], {
            cwd: dataFolder,
            env: {
                ...process.env,
                ...runtime.env,
                RUIMTE_EXTENSION_ID: id,
                RUIMTE_EXTENSION_PERMISSIONS: JSON.stringify(Object.keys(extension.manifest.permissions ?? {}))
            },
            stdio: 'pipe'
        }) as ChildProcessWithoutNullStreams;
        const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers<void>();
        const { promise: ended, resolve: end } = Promise.withResolvers<void>();
        // One that hangs while it loads would otherwise hold every call to it for good.
        const startTimer = setTimeout(() => this.stop(id), CALL_TIMEOUT_MS);
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
            void this.files.append(store.logFile(id), chunk).catch(() => undefined);
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
            void this.files.append(this.options.store.logFile(id), `${line}\n`).catch(() => undefined);

            return;
        }

        if (message.type === 'ask') {
            void this.answerAsk(id, running, message.method, message.args).then(
                (result) => running.child.stdin.write(`${JSON.stringify({ type: 'answer', id: message.id, result: result ?? null })}\n`),
                (e: unknown) => {
                    const { code, message: reason } = extensionFailureOf(e);

                    // A refusal answers as a Result, so the terminal of `extension dev` is where a person still sees it.
                    void this.files.append(this.options.store.logFile(id), `${message.method} answered ${code}: ${reason}\n`).catch(() => undefined);
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

        void this.files.append(this.options.store.logFile(id), `${reason}\n`).catch(() => undefined);
    }

    /* Whoever asks, client or `server/`: a chat the person sees, behind the same permission. */
    async startAgent(id: string, start: ExtensionChatStart): Promise<{ nodeId: string }> {
        await this.requirePermission(id, 'agents.start');

        if (this.options.startChat === undefined) {
            throw new ExtensionRefusal('unavailable', 'This machine does not start chats for an extension');
        }

        return this.options.startChat(id, start);
    }

    /* An action of the machine, within the list and the manifest. Both checked here, so the client's own check is only a courtesy. */
    async runAction(id: string, projectId: string, action: string, input: unknown): Promise<unknown> {
        refuse(actionRefusal(id, action, await this.permissionsOf(id)));

        if (this.options.runAction === undefined) {
            throw new ExtensionRefusal('unavailable', 'This machine does not run actions for an extension');
        }

        // `actionRefusal` let through only a name of `EXTENSION_ACTIONS`.
        return this.options.runAction(id, projectId, action as ExtensionActionName, input);
    }

    /* What the manifest asks for as it is stored now, so an update that drops a permission takes it away at once. */
    private async permissionsOf(id: string): Promise<ReadonlySet<string>> {
        return permissionsOf((await this.options.store.get(id))?.manifest);
    }

    private async requirePermission(id: string, permission: string): Promise<void> {
        refuse(missingPermission(id, permission, await this.permissionsOf(id)));
    }

    /* What a client with no shell of its own loads. Not its server part, which only runs here. */
    async clientFiles(id: string): Promise<{ hash: string; files: Record<string, string> }> {
        const extension = await this.options.store.get(id);

        if (extension === null) {
            throw new ExtensionRefusal('not-found', `No extension ${id} on this machine`);
        }

        const files: Record<string, string> = {};
        const walk = async (folder: string, prefix: string): Promise<void> => {
            for (const entry of await readdir(folder, { withFileTypes: true })) {
                const path = `${prefix}${entry.name}`;

                if (entry.isDirectory()) {
                    if (prefix !== '' || CLIENT_FOLDERS.has(entry.name)) {
                        await walk(join(folder, entry.name), `${path}/`);
                    }
                } else if (prefix !== '' || entry.name === 'manifest.json') {
                    files[path] = (await readFile(join(folder, entry.name))).toString('base64');
                }
            }
        };

        await walk(extension.folder, '');

        return { hash: extension.hash, files };
    }

    private async answerAsk(id: string, running: Running, method: string, args: unknown[]): Promise<unknown> {
        refuse(askRefusal(id, method, args, await this.permissionsOf(id)));

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

            return this.runAction(id, projectId, action, input);
        }

        if (method === 'languages.add') {
            const add = this.options.addLanguageServer;

            if (add === undefined) {
                throw new ExtensionRefusal('unavailable', 'This machine does not add language servers for an extension');
            }

            // Between the changes of what runs, so a turn off either waits for it and takes it away, or comes first and refuses it.
            return this.lifecycle(id, async () => {
                if (this.running.get(id) !== running) {
                    throw stopped();
                }

                return add(id, args[0] as object);
            });
        }

        if (method === 'agents.start') {
            return this.startAgent(id, args[0] as ExtensionChatStart);
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

    private send(running: Running, message: object, label: string): Promise<unknown> {
        const id = running.nextCall;

        running.nextCall += 1;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                running.pending.delete(id);
                reject(new ExtensionRefusal('timeout', `${label} did not answer in time`));
            }, CALL_TIMEOUT_MS);

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
        this.crashes.set(id, (this.crashes.get(id) ?? 0) + 1);
        this.changed();
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
