import { readFile, realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { LanguageServerId, LanguageServerState } from '@ruimte/contracts';
import {
    bridgeVueTypeScript,
    ErrorCodes,
    LspError,
    LspSession,
    pathToFileUri,
    StaleResultError,
    vueServerOrder,
    watchesFile,
    type ApplyWorkspaceEditParams,
    type ApplyWorkspaceEditResult,
    type ContentChange,
    type Disposable,
    type DocumentDiagnosticReport,
    type FileSystemWatcher,
    type LspDocument,
    type ProgressParams,
    type PublishDiagnosticsParams
} from '@ruimte/smart-editor-lsp';
import { errorText } from '../error-text.ts';
import type { FileChange } from './file-watch.ts';
import { LanguageLog } from './log.ts';
import { mergeCodeActions, mergeProviders } from './merge.ts';
import {
    componentServes,
    lspLanguageId,
    resolveNativeTypescript,
    resolveTypescriptLib,
    type ComponentProfile,
    type KindProfile,
    type LaunchContext
} from './profiles.ts';
import type { LanguageChild, LanguageExit, LanguageRuntime, SpawnLanguageProcess } from './runtime.ts';

// How long a stopped process may take to go before it is killed.
export const STOP_GRACE_MS = 3_000;

// How long a server beside the first has to answer a request that merges the answers of several, after which it is left out.
export const MERGE_DEADLINE_MS = 1_000;

// How long the first code action request waits for a sidecar that has to start, which loads the project before it answers.
export const SIDECAR_START_DEADLINE_MS = 10_000;

// How long a process may take to answer its handshake before the kind counts as crashed.
export const INITIALIZE_TIMEOUT_MS = 30_000;

// How long a process has to have been ready for an end of its own to count as a crash worth one more start; one that ends sooner is a loop.
export const STABLE_AFTER_MS = 60_000;

// How long typing pauses before a server that is asked for its diagnostics is asked again.
export const PULL_DELAY_MS = 200;

export interface LanguageClock {
    set(run: () => void, ms: number): () => void;
}

export const realLanguageClock: LanguageClock = {
    set: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};

/* One file as the daemon holds it, shared by every client that has it open. The daemon owns the version. */
export interface SharedDocument {
    readonly absolutePath: string;
    readonly uri: string;
    /* The kinds of server that serve it, the one of its language first; empty for a language none serves, which the daemon still holds so a client's calls stay uniform. */
    kinds: LanguageServerId[];
    /* The stored path a client hears about it under. */
    readonly storedPath: string;
    languageId: string;
    text: string;
    version: number;
    readonly clients: Set<string>;
}

export interface LanguageServerHooks {
    /* The state, the message or the capabilities changed. */
    status(server: LanguageServer): void;
    diagnostics(document: SharedDocument, component: string, params: PublishDiagnosticsParams): void;
    /* What a document may ask changed. */
    providers(document: SharedDocument): void;
    /* The files a process asked to hear about changed, or the process went. */
    watching(server: LanguageServer): void;
    /* The server asks for an edit, which only the client that ran a command can be asked to make. */
    applyEdit(server: LanguageServer, params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult>;
}

export interface LanguageServerOptions {
    kind: LanguageServerId;
    /* What the kind runs: the catalog's, or the profile made of a server of a person's own. */
    profile: KindProfile;
    projectId: string;
    folder: string;
    installDirectory: string;
    /* What a kind that is a program of its own runs: the file and the stubs beside it. */
    native?: () => { executable: string; stubsCommit: string } | null;
    isInstalled(): Promise<boolean>;
    runtime: LanguageRuntime;
    spawn: SpawnLanguageProcess;
    clock?: LanguageClock;
    /* The time in milliseconds, which only the decision to start a crashed process again reads. */
    now?: () => number;
    exists(path: string): Promise<boolean>;
    /* The text of a file, or null when it cannot be read. */
    readText?: (path: string) => Promise<string | null>;
    realPath?: (path: string) => Promise<string>;
    hooks: LanguageServerHooks;
}

interface Component {
    profile: ComponentProfile;
    child: LanguageChild;
    session: LspSession;
    documents: Map<string, LspDocument>;
    progress: Set<string | number>;
    subscriptions: Disposable[];
    /* The diagnostics requests waiting for typing to pause, by document. */
    pulls: Map<string, () => void>;
}

/* A merged answer: items of several processes, each with the one that made it. */
export interface ServerReply {
    result: unknown;
    server: string;
    version: number;
    /* Set when the result is a list of items from more than one process. */
    itemServers?: string[];
}

type Expired = 'expired';

/* What a sidecar of code actions will offer, which is known before it starts. */
const SIDECAR_ACTION_OPTIONS = {
    resolveProvider: true,
    codeActionKinds: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'refactor.move']
};

type Phase = 'stopped' | 'starting' | 'ready' | 'crashed';

/*
 * The servers of one kind in one project: one process, or two for Vue. It starts when a document
 * needs it and an install exists, and goes when asked to stop. A process that ends by itself after
 * the kind had been ready for `STABLE_AFTER_MS` is started once more at once; any other end marks the
 * kind crashed, and only `restart` brings it back. The decision is made on the exit and never on a timer.
 */
export class LanguageServer {
    readonly kind: LanguageServerId;
    readonly projectId: string;
    readonly log = new LanguageLog();
    private readonly options: LanguageServerOptions;
    private readonly clock: LanguageClock;
    private readonly documents = new Map<string, SharedDocument>();
    private components: Component[] = [];
    private phase: Phase = 'stopped';
    private failure: string | undefined;
    private generation = 0;
    private readyAt: number | null = null;
    private startPromise: Promise<void> | undefined;
    private sidecarPromise: Promise<Component | null> | undefined;
    /* Why a sidecar did not start or ended, which keeps it from starting again until the kind does. */
    private sidecarFailure: string | undefined;

    constructor(options: LanguageServerOptions) {
        this.options = options;
        this.kind = options.kind;
        this.projectId = options.projectId;
        this.clock = options.clock ?? realLanguageClock;
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }

    get state(): LanguageServerState {
        if (this.phase === 'ready' && this.components.some((component) => component.profile.sidecar !== true && component.progress.size > 0)) {
            return 'indexing';
        }
        return this.phase;
    }

    /* What a failure of the server calls it. */
    private get label(): string {
        return this.options.profile.components[0]?.title ?? this.kind;
    }

    get message(): string | undefined {
        return this.failure;
    }

    /* The sidecars of the kind and how they are doing, for a status. */
    get sidecars(): Array<{ name: string; title: string; state: 'idle' | 'starting' | 'ready' | 'crashed'; message?: string }> {
        return this.options.profile.components
            .filter((profile) => profile.sidecar === true)
            .map((profile) => {
                const component = this.components.find((candidate) => candidate.profile === profile);
                const title = profile.title ?? profile.name;
                if (this.sidecarFailure !== undefined) {
                    return { name: profile.name, title, state: 'crashed', message: this.sidecarFailure };
                }
                return { name: profile.name, title, state: component === undefined ? 'idle' : component.session.state === 'ready' ? 'ready' : 'starting' };
            });
    }

    get documentCount(): number {
        return this.documents.size;
    }

    /* The capabilities of each process once it answered its handshake, by the name of the process. */
    get capabilities(): Record<string, unknown> | undefined {
        if (this.phase !== 'ready' && this.phase !== 'starting') {
            return undefined;
        }
        const ready = this.components.filter((component) => component.session.state === 'ready');
        return ready.length === 0 ? undefined : Object.fromEntries(ready.map((component) => [component.profile.name, component.session.capabilities]));
    }

    /* What the processes registered to hear about when files change on disk. */
    watchedFiles(): FileSystemWatcher[] {
        return this.components.filter((component) => component.session.state === 'ready').flatMap((component) => component.session.watchedFiles());
    }

    /* Tells each process the changes its own patterns name. */
    async filesChanged(changes: readonly FileChange[]): Promise<void> {
        await Promise.all(
            this.components.map(async (component) => {
                if (component.session.state !== 'ready') {
                    return;
                }
                const watchers = component.session.watchedFiles();
                const named = changes.filter((change) => watchesFile(watchers, this.options.folder, change.path, change.type));
                if (named.length === 0) {
                    return;
                }
                try {
                    await component.session.didChangeWatchedFiles(named.map((change) => ({ uri: pathToFileUri(change.path), type: change.type })));
                } catch (error) {
                    this.log.push('host', `Could not tell the server about changed files: ${errorText(error)}`);
                }
            })
        );
    }

    /* Whether this server serves a document of the language at all. */
    serves(languageId: string): boolean {
        const id = lspLanguageId(languageId);
        return this.options.profile.components.some((component) => component.languages.includes(id));
    }

    attach(document: SharedDocument): void {
        this.documents.set(document.absolutePath, document);
        if (this.phase === 'ready') {
            this.openInComponents(document);
            return;
        }
        void this.ensureStarted();
    }

    async detach(document: SharedDocument): Promise<void> {
        this.documents.delete(document.absolutePath);
        await Promise.all(
            this.components.map(async (component) => {
                const open = component.documents.get(document.absolutePath);
                component.documents.delete(document.absolutePath);
                component.pulls.get(document.absolutePath)?.();
                component.pulls.delete(document.absolutePath);
                await open?.close().catch((error) => this.log.push('host', errorText(error)));
            })
        );
    }

    /*
     * Starts the processes when a document waits for them and the kind is installed; nothing happens
     * otherwise, and a crashed kind stays crashed. Callers share the start that is under way.
     */
    ensureStarted(): Promise<void> {
        this.startPromise ??= this.begin().finally(() => {
            this.startPromise = undefined;
        });
        return this.startPromise;
    }

    private async begin(): Promise<void> {
        const generation = this.generation;
        if (this.phase !== 'stopped' || this.documents.size === 0 || !(await this.options.isInstalled())) {
            return;
        }
        // A stop that came while the install was looked up wins.
        if (generation !== this.generation || this.phase !== 'stopped' || this.documents.size === 0) {
            return;
        }
        await this.start();
    }

    /* Forwards a change of the shared text to every process that has the document open. */
    async change(document: SharedDocument, changes: readonly ContentChange[]): Promise<void> {
        await Promise.all(
            this.components.map(async (component) => {
                const open = component.documents.get(document.absolutePath);
                if (!open) {
                    return;
                }
                try {
                    await open.applyChanges(changes);
                    this.schedulePulls(component, document, open);
                } catch (error) {
                    this.log.push('host', `Could not forward a change of ${document.storedPath}: ${errorText(error)}`);
                }
            })
        );
    }

    /* Whether a process of this server could answer `method` for the document right now. */
    canAnswer(document: SharedDocument, method: string, params?: object, hint?: string): boolean {
        if (this.phase !== 'ready') {
            return false;
        }
        const answers = this.orderFor(document, method, params ?? {}, hint).some((component) => {
            const open = component.documents.get(document.absolutePath);
            return open !== undefined && component.session.supports(method, open);
        });
        return answers || (hint === undefined && this.sidecarFor(document, method, params ?? {}) !== undefined);
    }

    /* Whether one of the processes of this server goes by this name. */
    hasComponent(name: string): boolean {
        return this.options.profile.components.some((component) => component.name === name);
    }

    /* What the document may ask: by method, the options of the first process that supports it. */
    providers(document: SharedDocument, methods: readonly string[]): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const component of this.orderFor(document, '', undefined)) {
            const open = component.documents.get(document.absolutePath);
            if (!open) {
                continue;
            }
            for (const method of methods) {
                const options = component.session.providerOptions(method, open);
                if (options !== undefined && !(method in result) && component.session.state === 'ready') {
                    result[method] = options;
                }
            }
        }
        // The sidecar has not started yet when it is first asked, so what it will offer is known from what it is for.
        if (methods.includes('textDocument/codeAction') && this.sidecarFor(document, 'textDocument/codeAction', {}) !== undefined) {
            return mergeProviders([result, { 'textDocument/codeAction': SIDECAR_ACTION_OPTIONS }]);
        }
        return result;
    }

    /*
     * Asks the process that answers `method` for this document: the one a resolve names, else the
     * first of the Vue pair that supports it. Concurrent clients never cancel each other, so
     * superseding is the client's.
     */
    async request(document: SharedDocument, method: string, params: object, hint?: string): Promise<ServerReply> {
        if (this.phase !== 'ready') {
            throw new LspError(`The ${this.label} language server is ${this.state}`, ErrorCodes.ServerNotInitialized);
        }
        const sidecar = hint === undefined ? this.sidecarFor(document, method, params) : undefined;
        if (sidecar === undefined) {
            return this.requestProcess(document, method, params, hint);
        }
        const [main, extra] = await Promise.allSettled([this.requestProcess(document, method, params), this.askSidecar(sidecar, document, method, params)]);
        if (extra.status === 'rejected') {
            this.log.push('host', `The sidecar failed ${method}: ${errorText(extra.reason)}`);
        }
        if (extra.status === 'rejected' || extra.value === null) {
            if (main.status === 'rejected') {
                throw main.reason;
            }
            return main.value;
        }
        if (main.status === 'rejected') {
            return extra.value;
        }
        const merged = mergeCodeActions({ server: main.value.server, result: main.value.result }, { server: extra.value.server, result: extra.value.result });
        return { ...main.value, result: merged.result, itemServers: merged.itemServers };
    }

    private async requestProcess(document: SharedDocument, method: string, params: object, hint?: string): Promise<ServerReply> {
        for (const component of this.orderFor(document, method, params, hint)) {
            const open = component.documents.get(document.absolutePath);
            if (open && component.session.supports(method, open)) {
                const result = await open.request(method, params, { cancelPrevious: false, timeoutMs: 0 });
                return { result, server: component.profile.name, version: open.version };
            }
        }
        throw new LspError(`No ${this.label} server answers ${method} for this document`, ErrorCodes.MethodNotFound);
    }

    /* The sidecar that should be asked for this: code actions for a document it serves, when a person is after fixes or refactors and it has not failed. */
    private sidecarFor(document: SharedDocument, method: string, params: object): ComponentProfile | undefined {
        if (method !== 'textDocument/codeAction' || this.sidecarFailure !== undefined || this.phase !== 'ready') {
            return undefined;
        }
        const only = (params as { context?: { only?: string[] } }).context?.only ?? [];
        // Organize imports and the like are the native server's own, and not worth starting a second process for.
        if (only.length > 0 && !only.some((kind) => kind === '' || kind.startsWith('quickfix') || kind.startsWith('refactor'))) {
            return undefined;
        }
        return this.options.profile.components.find(
            (profile) => profile.sidecar === true && componentServes(profile, document.languageId, document.storedPath)
        );
    }

    /*
     * The answer of the sidecar, started with the first call and kept in step with the documents after
     * that. Null when it did not answer in time (the first call allows for the start), failed or could
     * not start; the others' answer then stands alone.
     */
    private async askSidecar(profile: ComponentProfile, document: SharedDocument, method: string, params: object): Promise<ServerReply | null> {
        const cold = !this.components.some((component) => component.profile === profile && component.session.state === 'ready');
        const answer = (async (): Promise<ServerReply | null> => {
            const component = await this.ensureSidecar(profile);
            const open = component?.documents.get(document.absolutePath);
            if (!component || !open || !component.session.supports(method, open)) {
                return null;
            }
            const result = await open.request(method, params, { cancelPrevious: false, timeoutMs: 0 });
            return { result, server: profile.name, version: open.version };
        })();
        const outcome = await this.beforeDeadline(answer, cold ? SIDECAR_START_DEADLINE_MS : MERGE_DEADLINE_MS);
        if (outcome === 'expired') {
            this.log.push(
                'host',
                `${profile.title ?? profile.name} did not answer ${method} within ${(cold ? SIDECAR_START_DEADLINE_MS : MERGE_DEADLINE_MS) / 1000} seconds and was left out`
            );
            // A late answer is dropped, and a failure of it is the log's.
            answer.catch((error) => this.log.push('host', errorText(error)));
            return null;
        }
        return outcome;
    }

    private async beforeDeadline<T>(answer: Promise<T>, ms: number): Promise<T | Expired> {
        let cancel = (): void => undefined;
        const expired = new Promise<Expired>((resolve) => {
            cancel = this.clock.set(() => resolve('expired'), ms);
        });
        try {
            return await Promise.race([answer, expired]);
        } finally {
            cancel();
        }
    }

    /* Runs a server command for this document, on the process that offered it (`hint`) or the first that supports commands. */
    async executeCommand(document: SharedDocument, command: string, args: unknown[] | undefined, hint?: string): Promise<{ result: unknown; server: string }> {
        if (this.phase !== 'ready') {
            throw new LspError(`The ${this.label} language server is ${this.state}`, ErrorCodes.ServerNotInitialized);
        }
        for (const component of this.orderFor(document, 'workspace/executeCommand', {}, hint)) {
            if (component.documents.has(document.absolutePath) && component.session.supports('workspace/executeCommand')) {
                const result = await component.session.executeCommand(command, args, { timeoutMs: 0 });
                return { result, server: component.profile.name };
            }
        }
        throw new LspError(`No ${this.label} server runs commands for this document`, ErrorCodes.MethodNotFound);
    }

    /* A person's restart, the only way out of crashed. */
    async restart(): Promise<void> {
        await this.stop();
        await this.startPromise;
        this.failure = undefined;
        this.notify();
        await this.ensureStarted();
    }

    /* Ends the processes and leaves the documents attached, for a restart or for the project going. */
    async stop(): Promise<void> {
        this.generation++;
        this.sidecarPromise = undefined;
        const components = this.components;
        this.components = [];
        this.phase = 'stopped';
        for (const component of components) {
            component.documents.clear();
        }
        this.options.hooks.watching(this);
        // The Vue server first, since it leans on the TypeScript one.
        for (const component of [...components].reverse()) {
            await this.shutdown(component);
        }
        this.notify();
    }

    private async start(): Promise<void> {
        const generation = ++this.generation;
        this.phase = 'starting';
        this.failure = undefined;
        this.notify();
        this.sidecarFailure = undefined;
        const { installDirectory, folder, exists } = this.options;
        const context: LaunchContext = {
            installDirectory,
            projectFolder: folder,
            typescriptLib: await resolveTypescriptLib(folder, installDirectory, exists),
            native: this.options.native?.() ?? null,
            typescriptExecutable: this.options.profile.components.some((component) => component.native)
                ? await resolveNativeTypescript(folder, installDirectory, {
                      exists,
                      readText: this.options.readText ?? ((path) => readFile(path, 'utf8').catch(() => null)),
                      realPath: this.options.realPath ?? realpath
                  })
                : ''
        };
        try {
            for (const profile of this.options.profile.components.filter((candidate) => candidate.sidecar !== true)) {
                if (generation !== this.generation) {
                    return;
                }
                const component = this.spawnComponent(profile, context, generation);
                this.components.push(component);
                if (profile.name === 'vue') {
                    const typescript = this.components.find((candidate) => candidate.profile.name === 'typescript');
                    if (typescript) {
                        component.subscriptions.push(bridgeVueTypeScript(component.session, typescript.session));
                    }
                }
                await this.withinHandshake(component.session.initialize(), profile);
            }
            if (generation !== this.generation) {
                return;
            }
            this.phase = 'ready';
            this.readyAt = this.now();
            this.notify();
            for (const document of this.documents.values()) {
                this.openInComponents(document);
            }
        } catch (error) {
            // A stop that came while the handshake ran closed the connection under it, which is no crash.
            if (generation === this.generation) {
                await this.fail(`The ${this.label} language server did not start: ${errorText(error)}`);
            }
        }
    }

    /* A server that never answers its handshake would leave the kind starting for good. */
    private withinHandshake(handshake: Promise<unknown>, profile: ComponentProfile): Promise<unknown> {
        let cancel = (): void => undefined;
        const expired = new Promise<never>((_, reject) => {
            cancel = this.clock.set(
                () =>
                    reject(
                        new Error(`the ${profile.title ?? profile.name} process did not answer its handshake within ${INITIALIZE_TIMEOUT_MS / 1000} seconds`)
                    ),
                INITIALIZE_TIMEOUT_MS
            );
        });
        return Promise.race([handshake, expired]).finally(cancel);
    }

    /* Starts the sidecar, or joins the start under way. Null when it cannot start, which is remembered until the kind starts again. */
    private ensureSidecar(profile: ComponentProfile): Promise<Component | null> {
        const running = this.components.find((component) => component.profile === profile && component.session.state === 'ready');
        if (running) {
            return Promise.resolve(running);
        }
        if (this.sidecarPromise === undefined) {
            const starting: Promise<Component | null> = this.startSidecar(profile).finally(() => {
                if (this.sidecarPromise === starting) {
                    this.sidecarPromise = undefined;
                }
            });
            this.sidecarPromise = starting;
        }
        return this.sidecarPromise;
    }

    private async startSidecar(profile: ComponentProfile): Promise<Component | null> {
        const generation = this.generation;
        if (this.phase !== 'ready' || this.sidecarFailure !== undefined) {
            return null;
        }
        const { installDirectory, folder, exists } = this.options;
        const context: LaunchContext = {
            installDirectory,
            projectFolder: folder,
            typescriptLib: await resolveTypescriptLib(folder, installDirectory, exists, profile.sdkPackage),
            typescriptExecutable: ''
        };
        if (generation !== this.generation) {
            return null;
        }
        this.notify();
        const component = this.spawnComponent(profile, context, generation);
        this.components.push(component);
        this.notify();
        try {
            await this.withinHandshake(component.session.initialize(), profile);
        } catch (error) {
            if (generation === this.generation) {
                this.dropSidecar(component, `The ${profile.title ?? profile.name} process did not start: ${errorText(error)}`);
            }
            return null;
        }
        if (generation !== this.generation) {
            return null;
        }
        for (const document of this.documents.values()) {
            this.openInComponents(document, [component]);
        }
        this.notify();
        return component;
    }

    /* A sidecar that failed or ended is let go of, and stays away until the kind starts again; the kind itself carries on. */
    private dropSidecar(component: Component, message: string): void {
        if (!this.components.includes(component)) {
            return;
        }
        this.components = this.components.filter((candidate) => candidate !== component);
        component.documents.clear();
        this.release(component);
        component.child.kill('SIGTERM');
        this.sidecarFailure = message;
        this.log.push('host', message);
        this.notify();
    }

    private spawnComponent(profile: ComponentProfile, context: LaunchContext, generation: number): Component {
        const { runtime } = this.options;
        const own = profile.native ? context.typescriptExecutable : (profile.program?.(context) ?? profile.command);
        const child = this.options.spawn(
            own === undefined
                ? {
                      command: runtime.command,
                      args: [...runtime.args, `${context.installDirectory}/node_modules/${profile.entry}`, ...profile.args(context)],
                      cwd: this.options.folder,
                      env: { ...runtime.env, ...profile.env }
                  }
                : { command: own, args: profile.args(context), cwd: this.options.folder, env: { ...profile.env } }
        );
        const rootUri = pathToFileUri(this.options.folder);
        const session = new LspSession(child.transport, {
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: basename(this.options.folder) }],
            initializationOptions: profile.initializationOptions(context),
            clientInfo: { name: 'ruimte' },
            snippetSupport: true,
            ...(profile.configuration === undefined ? {} : { configuration: profile.configuration }),
            onApplyEdit: (params) => this.options.hooks.applyEdit(this, params),
            timeoutMs: 0
        });
        const component: Component = { profile, child, session, documents: new Map(), progress: new Set(), subscriptions: [], pulls: new Map() };
        child.onStderr((text) => this.log.push('server', text));
        component.subscriptions.push(
            session.onError((error) => this.log.push('host', errorText(error))),
            session.onNotification('window/logMessage', (params) => this.log.push('server', String((params as { message?: unknown }).message ?? ''))),
            session.onProgress((params) => this.progressed(component, params)),
            session.onDiagnostics((params) => {
                const document = this.documentByUri(params.uri);
                // The diagnostics of the native server are the ones shown, so a sidecar's would only repeat or contradict them.
                if (document && profile.sidecar !== true) {
                    this.options.hooks.diagnostics(document, profile.name, params);
                }
            }),
            session.onCapabilitiesChanged(() => this.refreshed())
        );
        void child.exited.then((exit) => this.exited(component, exit, generation));
        return component;
    }

    private openInComponents(document: SharedDocument, only: readonly Component[] = this.components): void {
        for (const component of only) {
            // A sidecar that is still starting opens every document once it is up.
            if (
                component.session.state !== 'ready' ||
                !componentServes(component.profile, document.languageId, document.storedPath) ||
                component.documents.has(document.absolutePath)
            ) {
                continue;
            }
            try {
                component.documents.set(
                    document.absolutePath,
                    component.session.openDocument({
                        uri: document.uri,
                        languageId: lspLanguageId(document.languageId),
                        text: document.text,
                        version: document.version
                    })
                );
                void this.pull(component, document);
            } catch (error) {
                this.log.push('host', `Could not open ${document.storedPath}: ${errorText(error)}`);
            }
        }
        this.options.hooks.providers(document);
    }

    private orderFor(document: SharedDocument, method: string, params: unknown, hint?: string): Component[] {
        const named = (name: string): Component[] => this.components.filter((component) => component.profile.name === name);
        if (hint) {
            return named(hint);
        }
        if (this.kind === 'vue') {
            return vueServerOrder(method, document.text, params).flatMap(named);
        }
        // A sidecar answers only for what it was asked, by name, or through `askSidecar`.
        return this.components.filter((component) => component.profile.sidecar !== true);
    }

    private documentByUri(uri: string): SharedDocument | undefined {
        return [...this.documents.values()].find((document) => document.uri === uri);
    }

    private progressed(component: Component, params: ProgressParams): void {
        const kind = (params.value as { kind?: string } | null)?.kind;
        const before = this.state;
        if (kind === 'begin') {
            component.progress.add(params.token);
        } else if (kind === 'end') {
            component.progress.delete(params.token);
        }
        if (this.state !== before) {
            this.notify();
        }
    }

    private refreshed(): void {
        this.options.hooks.watching(this);
        if (this.phase !== 'ready') {
            return;
        }
        for (const document of this.documents.values()) {
            this.options.hooks.providers(document);
            for (const component of this.components) {
                this.schedulePull(component, document);
            }
        }
    }

    /* The changed document is asked again, and with a server whose diagnostics reach across files every other document of it too. */
    private schedulePulls(component: Component, changed: SharedDocument, open: LspDocument): void {
        const acrossFiles = component.session.providerOptions('textDocument/diagnostic', open)?.interFileDependencies === true;
        for (const document of this.documents.values()) {
            if (document === changed || (acrossFiles && component.documents.has(document.absolutePath))) {
                this.schedulePull(component, document);
            }
        }
    }

    private schedulePull(component: Component, document: SharedDocument): void {
        if (!component.profile.pullDiagnostics) {
            return;
        }
        component.pulls.get(document.absolutePath)?.();
        component.pulls.set(
            document.absolutePath,
            this.clock.set(() => {
                component.pulls.delete(document.absolutePath);
                void this.pull(component, document);
            }, PULL_DELAY_MS)
        );
    }

    /* Asks a server that does not push for the diagnostics of the document as it stands, and reports them as a push would. */
    private async pull(component: Component, document: SharedDocument): Promise<void> {
        const open = component.documents.get(document.absolutePath);
        if (!open || !component.profile.pullDiagnostics || !component.session.supports('textDocument/diagnostic', open)) {
            return;
        }
        try {
            const report = await open.diagnostics(undefined, undefined, { timeoutMs: 0 });
            if (component.documents.get(document.absolutePath) !== open) {
                return;
            }
            if (report.kind === 'full') {
                this.options.hooks.diagnostics(document, component.profile.name, { uri: document.uri, version: open.version, diagnostics: report.items });
            }
            this.reportRelated(component, report.relatedDocuments);
        } catch (error) {
            // A request overtaken by a change or a newer request is not a failure.
            if (!(error instanceof StaleResultError) && !(error instanceof LspError && error.code === ErrorCodes.RequestCancelled)) {
                this.log.push('host', `Could not read the diagnostics of ${document.storedPath}: ${errorText(error)}`);
            }
        }
    }

    /* A report may carry the diagnostics of other documents; those the server has open are reported as if pulled for themselves. */
    private reportRelated(component: Component, related: Record<string, DocumentDiagnosticReport> | undefined): void {
        for (const [uri, report] of Object.entries(related ?? {})) {
            const document = this.documentByUri(uri);
            const open = document && component.documents.get(document.absolutePath);
            if (document && open && report.kind === 'full') {
                this.options.hooks.diagnostics(document, component.profile.name, { uri, version: open.version, diagnostics: report.items });
            }
        }
    }

    private exited(component: Component, exit: LanguageExit, generation: number): void {
        if (generation !== this.generation || !this.components.includes(component)) {
            return;
        }
        const reason = exit.error
            ? `could not run: ${exit.error}`
            : exit.signal
              ? `was stopped by ${exit.signal}`
              : `exited with code ${exit.code ?? 'unknown'}`;
        const said = this.log.last('server');
        const message = `The ${component.profile.title ?? component.profile.name} language server ${reason}${said ? `: ${said}` : ''}`;
        if (component.profile.sidecar === true) {
            this.dropSidecar(component, message);
        } else if (this.phase === 'ready' && this.readyAt !== null && this.now() - this.readyAt >= STABLE_AFTER_MS) {
            void this.recover(message);
        } else {
            void this.fail(message);
        }
    }

    /* A process that ran for a while and then ended: its kind starts again with the documents it holds, and a second end soon after is a crash. */
    private async recover(message: string): Promise<void> {
        this.teardown();
        this.phase = 'stopped';
        this.log.push('host', `${message}; starting it again`);
        await this.ensureStarted();
    }

    private async fail(message: string): Promise<void> {
        this.teardown();
        this.phase = 'crashed';
        this.failure = message;
        this.log.push('host', message);
        this.notify();
    }

    /* Lets go of the processes of a run that ended, and of what they reported. */
    private teardown(): void {
        const components = this.components;
        this.components = [];
        this.generation++;
        this.readyAt = null;
        this.sidecarPromise = undefined;
        for (const component of components) {
            this.clearReports(component);
            component.documents.clear();
            this.release(component);
            component.child.kill('SIGTERM');
        }
        this.options.hooks.watching(this);
        for (const document of this.documents.values()) {
            this.options.hooks.providers(document);
        }
    }

    /* What a process reported goes with it, so a crashed or stopped server leaves no problems behind in the clients. */
    private clearReports(component: Component): void {
        for (const path of component.documents.keys()) {
            const document = this.documents.get(path);
            if (document) {
                this.options.hooks.diagnostics(document, component.profile.name, { uri: document.uri, diagnostics: [] });
            }
        }
    }

    private release(component: Component): void {
        for (const subscription of component.subscriptions) {
            subscription.dispose();
        }
        component.subscriptions = [];
        for (const cancel of component.pulls.values()) {
            cancel();
        }
        component.pulls.clear();
    }

    private async shutdown(component: Component): Promise<void> {
        await component.session.shutdown().catch((error) => this.log.push('host', errorText(error)));
        this.release(component);
        component.child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
            const cancel = this.clock.set(() => {
                component.child.kill('SIGKILL');
                resolve();
            }, STOP_GRACE_MS);
            void component.child.exited.then(() => {
                cancel();
                resolve();
            });
        });
    }

    private notify(): void {
        this.options.hooks.status(this);
    }
}
