import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExtensionInfo, ExtensionStatus } from '@ruimte/contracts';
import { VerbRefusal } from '../canvas/verb.ts';
import { errorText } from '../error-text.ts';
import { bunRuntime } from '../language/runtime.ts';
// @ts-expect-error Bun hands over the file's text, so a compiled daemon carries it; TypeScript only knows the module.
import runtimeSource from './server-runtime.ts' with { type: 'text' };
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { ExtensionPackError, type ExtensionStore, type StoredExtension } from './store.ts';

// Under the client's 60 seconds, so a person reads this answer rather than a dropped request.
const CALL_TIMEOUT_MS = 50_000;
const MAX_CRASHES = 3;
const RUNTIME_FILE = 'runtime.ts';

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
    subscriptions: Set<string>;
    nextCall: number;
    buffered: string;
    stopping: boolean;
}

/* What `server/` may ask the daemon, each behind the permission of the same name. */
export type ExtensionAsks = Readonly<Record<string, (...args: never[]) => Promise<unknown>>>;

// A loop of an extension and a chat costs the person's plan, so a chat stops listening well before that hurts.
const MAX_SENDS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;

export interface ExtensionHostOptions {
    store: ExtensionStore;
    asks?: () => ExtensionAsks;
    now?: () => number;
    spawnProcess?: typeof spawn;
}

/*
 * Runs each extension's `server/` as a process of its own, as the person who runs the machine: a crash
 * stays out of the daemon and its sessions. It starts on the first call, or with the machine for
 * `autostart`. After three crashes in a row it stays down until a person turns it on again.
 *
 * Stopping one is the host's to do, unlike a person's own processes: it started this one and nothing
 * else depends on it.
 */
function startsWithMachine(manifest: ExtensionInfo['manifest']): boolean {
    return manifest.autostart === true || Object.hasOwn(manifest.permissions ?? {}, 'agents.tools');
}

export class ExtensionHost {
    private readonly running = new Map<string, Running>();
    private readonly crashes = new Map<string, number>();
    private readonly sinks = new ClientSinks();
    private readonly sends = new Map<string, number[]>();
    private readonly tools = new Map<string, { description: string; parameters: unknown }>();

    private readonly options: ExtensionHostOptions;

    constructor(options: ExtensionHostOptions) {
        this.options = options;
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
                await this.start(extension).catch((e: unknown) => console.warn(`Extension ${extension.manifest.id} did not start: ${errorText(e)}`));
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

    /* Hands a machine event to every running extension that asked for it. */
    forwardEvent(name: string, payload: unknown): void {
        for (const running of this.running.values()) {
            if (running.subscriptions.has(name)) {
                running.child.stdin.write(`${JSON.stringify({ type: 'event', name, payload })}\n`);
            }
        }
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        await this.options.store.setEnabled(id, enabled);
        this.crashes.delete(id);
        this.stop(id);

        if (enabled) {
            const extension = await this.options.store.get(id);

            if (extension !== null && startsWithMachine(extension.manifest)) {
                await this.start(extension);
            }
        }

        this.changed();
    }

    async install(pack: string): Promise<ExtensionInfo> {
        const extension = await this.options.store.install(pack);

        this.crashes.delete(extension.manifest.id);
        this.stop(extension.manifest.id);

        if (extension.enabled && startsWithMachine(extension.manifest)) {
            await this.start(extension);
        }

        this.changed();

        return (await this.list()).find((entry) => entry.manifest.id === extension.manifest.id) as ExtensionInfo;
    }

    async remove(id: string): Promise<void> {
        this.stop(id);
        await this.options.store.remove(id);
        this.crashes.delete(id);
        this.changed();
    }

    /* A save in dev: a fresh process over what was just built, and word so a client loads it again. */
    async linked(folder: string): Promise<string> {
        const manifest = await this.options.store.link(folder);

        this.crashes.delete(manifest.id);
        this.stop(manifest.id);
        this.changed();

        return manifest.id;
    }

    async unlink(id: string): Promise<void> {
        this.stop(id);
        await this.options.store.unlink(id);
        this.changed();
    }

    /* The same file `storage` in `server/` writes, so both ends of an extension read one truth. */
    private async storageOf(id: string): Promise<{ file: string; values: Record<string, unknown> }> {
        const file = join(this.options.store.dataFolder(id), 'storage.json');
        const values = await readFile(file, 'utf8')
            .then((text) => JSON.parse(text) as Record<string, unknown>)
            .catch(() => ({}));

        return { file, values };
    }

    async storageGet(id: string, key: string): Promise<unknown> {
        return (await this.storageOf(id)).values[key];
    }

    async storageSet(id: string, key: string, value: unknown): Promise<void> {
        const { file, values } = await this.storageOf(id);

        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ ...values, [key]: value }), { mode: 0o600 });
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

    /* What a client of an extension in development says. Nothing keeps it for one that is installed. */
    async appendDevLog(id: string, text: string): Promise<void> {
        const extension = await this.options.store.get(id);

        if (extension?.devFolder === undefined) {
            return;
        }

        const file = this.options.store.logFile(id);

        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${text}\n`);
    }

    stopAll(): void {
        for (const id of [...this.running.keys()]) {
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
        const running = this.running.get(id);

        if (running === undefined) {
            return;
        }

        running.stopping = true;
        running.child.kill();
        this.running.delete(id);
        this.forgetTools(id);
        this.failPending(running, new Error('The extension stopped'));
    }

    private async runningFor(id: string): Promise<Running> {
        const running = this.running.get(id);

        if (running !== undefined) {
            await running.ready;

            return running;
        }

        const extension = await this.options.store.get(id);

        if (extension === null) {
            throw new ExtensionPackError('extension-unknown', `No extension ${id} on this machine`);
        }

        if (!extension.enabled) {
            throw new ExtensionPackError('extension-unknown', `${id} is turned off`);
        }

        if ((this.crashes.get(id) ?? 0) >= MAX_CRASHES) {
            throw new Error(`${id} crashed ${MAX_CRASHES} times in a row and stays off until a person turns it on again`);
        }

        return this.start(extension);
    }

    private async start(extension: StoredExtension): Promise<Running> {
        const { store, spawnProcess = spawn } = this.options;
        const { id } = extension.manifest;
        const entry = store.serverEntry(extension);

        if (entry === null) {
            throw new ExtensionPackError('extension-unknown', `${id} has no server part`);
        }

        const dataFolder = store.dataFolder(id);
        const runtimePath = join(dataFolder, '.runtime', RUNTIME_FILE);

        await mkdir(dirname(runtimePath), { recursive: true });
        await writeFile(runtimePath, runtimeSource);

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
            subscriptions: new Set(),
            nextCall: 1,
            buffered: '',
            stopping: false
        };

        // A stop while nobody waits on the start is no failure of anyone's.
        ready.catch(() => undefined);
        this.running.set(id, running);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.read(id, running, chunk, markReady));
        child.stderr.on('data', (chunk: Buffer) => {
            void appendFile(store.logFile(id), chunk).catch(() => undefined);
        });
        // A pipe that breaks with the process says so here; the exit below is what acts on it.
        child.stdin.on('error', () => undefined);
        child.on('error', (e) => this.exited(id, running, e));
        child.on('exit', () => this.exited(id, running, new Error('The extension stopped')));
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
        let message: { type?: string; id?: number; result?: unknown; error?: string; name?: string; payload?: unknown };

        try {
            message = JSON.parse(line) as typeof message;
        } catch {
            return;
        }

        if (message.type === 'ask' && message.id !== undefined) {
            const asked = message as unknown as { id: number; method: string; args: unknown[] };

            void this.answerAsk(id, asked.method, asked.args).then(
                (result) => running.child.stdin.write(`${JSON.stringify({ type: 'answer', id: asked.id, result: result ?? null })}\n`),
                (e: unknown) => running.child.stdin.write(`${JSON.stringify({ type: 'answer', id: asked.id, error: errorText(e) })}\n`)
            );
        } else if (message.type === 'tool') {
            const tool = message as unknown as { name: string; description: string; parameters: unknown };

            void this.options.store.get(id).then((extension) => {
                if (Object.hasOwn(extension?.manifest.permissions ?? {}, 'agents.tools')) {
                    this.tools.set(`${id}/${tool.name}`, { description: tool.description, parameters: tool.parameters });
                }
            });
        } else if (message.type === 'ready') {
            this.crashes.delete(id);
            markReady();
        } else if (message.type === 'subscribe' && message.name !== undefined) {
            running.subscriptions.add(message.name);
        } else if (message.type === 'emit' && message.name !== undefined) {
            this.sinks.emit({ event: 'extension.message', payload: { id, name: message.name, payload: message.payload } });
        } else if (message.type === 'result' && message.id !== undefined) {
            const pending = running.pending.get(message.id);

            if (pending !== undefined) {
                running.pending.delete(message.id);
                clearTimeout(pending.timer);

                if (message.error === undefined) {
                    pending.resolve(message.result);
                } else {
                    pending.reject(new Error(message.error));
                }
            }
        }
    }

    private async answerAsk(id: string, method: string, args: unknown[]): Promise<unknown> {
        const extension = await this.options.store.get(id);
        const permission = method === 'chats.list' ? 'chats.read' : method;

        if (!Object.hasOwn(extension?.manifest.permissions ?? {}, permission)) {
            throw new Error(`${id} did not ask for the permission ${permission} in its manifest`);
        }

        const run = this.options.asks?.()[method];

        if (run === undefined) {
            throw new Error(`This machine does not answer ${method}`);
        }

        if (method === 'chats.send') {
            this.countSend(id, String(args[0]));
        }

        return (run as (...values: unknown[]) => Promise<unknown>)(...args);
    }

    private countSend(id: string, chatId: string): void {
        const now = (this.options.now ?? Date.now)();
        const key = `${id}:${chatId}`;
        const recent = (this.sends.get(key) ?? []).filter((at) => now - at < HOUR_MS);

        if (recent.length >= MAX_SENDS_PER_HOUR) {
            throw new Error(`${id} sent ${chatId} ${MAX_SENDS_PER_HOUR} messages this hour and has to wait`);
        }

        this.sends.set(key, [...recent, now]);
    }

    private send(running: Running, message: object, label: string): Promise<unknown> {
        const id = running.nextCall;

        running.nextCall += 1;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                running.pending.delete(id);
                reject(new Error(`${label} did not answer in time`));
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
