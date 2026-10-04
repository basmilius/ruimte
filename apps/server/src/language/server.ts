import { basename } from 'node:path';
import type { LanguageServerKind, LanguageServerState } from '@ruimte/contracts';
import {
    bridgeVueTypeScript,
    ErrorCodes,
    LspError,
    LspSession,
    pathToFileUri,
    vueServerOrder,
    type ContentChange,
    type Disposable,
    type LspDocument,
    type ProgressParams,
    type PublishDiagnosticsParams
} from '@ruimte/smart-editor-lsp';
import { errorText } from '../error-text.ts';
import { LanguageLog } from './log.ts';
import { KIND_PROFILES, lspLanguageId, resolveTypescriptLib, type ComponentProfile, type LaunchContext } from './profiles.ts';
import type { LanguageChild, LanguageExit, LanguageRuntime, SpawnLanguageProcess } from './runtime.ts';

// How long a stopped process may take to go before it is killed.
export const STOP_GRACE_MS = 3_000;

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
    /* The kind of server that serves it; null for a language none does, which the daemon still holds so a client's calls stay uniform. */
    kind: LanguageServerKind | null;
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
}

export interface LanguageServerOptions {
    kind: LanguageServerKind;
    projectId: string;
    folder: string;
    installDirectory: string;
    isInstalled(): Promise<boolean>;
    runtime: LanguageRuntime;
    spawn: SpawnLanguageProcess;
    clock?: LanguageClock;
    exists(path: string): Promise<boolean>;
    hooks: LanguageServerHooks;
}

interface Component {
    profile: ComponentProfile;
    child: LanguageChild;
    session: LspSession;
    documents: Map<string, LspDocument>;
    progress: Set<string | number>;
    subscriptions: Disposable[];
}

type Phase = 'stopped' | 'starting' | 'ready' | 'crashed';

/*
 * The servers of one kind in one project: one process, or two for Vue. It starts when a document
 * needs it and an install exists, and goes when asked to stop. A process that ends by itself marks
 * the kind crashed, and only `restart` brings it back, since nothing here retries on a clock.
 */
export class LanguageServer {
    readonly kind: LanguageServerKind;
    readonly projectId: string;
    readonly log = new LanguageLog();
    private readonly options: LanguageServerOptions;
    private readonly clock: LanguageClock;
    private readonly documents = new Map<string, SharedDocument>();
    private components: Component[] = [];
    private phase: Phase = 'stopped';
    private failure: string | undefined;
    private generation = 0;
    private startPromise: Promise<void> | undefined;

    constructor(options: LanguageServerOptions) {
        this.options = options;
        this.kind = options.kind;
        this.projectId = options.projectId;
        this.clock = options.clock ?? realLanguageClock;
    }

    get state(): LanguageServerState {
        if (this.phase === 'ready' && this.components.some((component) => component.progress.size > 0)) {
            return 'indexing';
        }
        return this.phase;
    }

    get message(): string | undefined {
        return this.failure;
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

    /* Whether this server serves a document of the language at all. */
    serves(languageId: string): boolean {
        const id = lspLanguageId(languageId);
        return KIND_PROFILES[this.kind].components.some((component) => component.languages.includes(id));
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
                } catch (error) {
                    this.log.push('host', `Could not forward a change of ${document.storedPath}: ${errorText(error)}`);
                }
            })
        );
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
        return result;
    }

    /*
     * Asks the process that answers `method` for this document: the one a resolve names, else the
     * first of the Vue pair that supports it. Concurrent clients never cancel each other, so
     * superseding is the client's.
     */
    async request(document: SharedDocument, method: string, params: object, hint?: string): Promise<{ result: unknown; server: string; version: number }> {
        if (this.phase !== 'ready') {
            throw new LspError(`The ${this.kind} language server is ${this.state}`, ErrorCodes.ServerNotInitialized);
        }
        for (const component of this.orderFor(document, method, params, hint)) {
            const open = component.documents.get(document.absolutePath);
            if (open && component.session.supports(method, open)) {
                const result = await open.request(method, params, { cancelPrevious: false, timeoutMs: 0 });
                return { result, server: component.profile.name, version: open.version };
            }
        }
        throw new LspError(`No ${this.kind} server answers ${method} for this document`, ErrorCodes.MethodNotFound);
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
        const components = this.components;
        this.components = [];
        this.phase = 'stopped';
        for (const component of components) {
            component.documents.clear();
        }
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
        const context: LaunchContext = {
            installDirectory: this.options.installDirectory,
            projectFolder: this.options.folder,
            typescriptLib: await resolveTypescriptLib(this.options.folder, this.options.installDirectory, this.options.exists)
        };
        try {
            for (const profile of KIND_PROFILES[this.kind].components) {
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
                await component.session.initialize();
            }
            if (generation !== this.generation) {
                return;
            }
            this.phase = 'ready';
            this.notify();
            for (const document of this.documents.values()) {
                this.openInComponents(document);
            }
        } catch (error) {
            // A stop that came while the handshake ran closed the connection under it, which is no crash.
            if (generation === this.generation) {
                await this.fail(`The ${this.kind} language server did not start: ${errorText(error)}`);
            }
        }
    }

    private spawnComponent(profile: ComponentProfile, context: LaunchContext, generation: number): Component {
        const { runtime } = this.options;
        const child = this.options.spawn({
            command: runtime.command,
            args: [...runtime.args, `${context.installDirectory}/node_modules/${profile.entry}`, ...profile.args(context)],
            cwd: this.options.folder,
            env: { ...runtime.env, ...profile.env }
        });
        const rootUri = pathToFileUri(this.options.folder);
        const session = new LspSession(child.transport, {
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: basename(this.options.folder) }],
            initializationOptions: profile.initializationOptions(context),
            clientInfo: { name: 'ruimte' },
            timeoutMs: 0
        });
        const component: Component = { profile, child, session, documents: new Map(), progress: new Set(), subscriptions: [] };
        child.onStderr((text) => this.log.push('server', text));
        component.subscriptions.push(
            session.onError((error) => this.log.push('host', errorText(error))),
            session.onNotification('window/logMessage', (params) => this.log.push('server', String((params as { message?: unknown }).message ?? ''))),
            session.onProgress((params) => this.progressed(component, params)),
            session.onDiagnostics((params) => {
                const document = this.documentByUri(params.uri);
                if (document) {
                    this.options.hooks.diagnostics(document, profile.name, params);
                }
            }),
            session.onCapabilitiesChanged(() => this.refreshed())
        );
        void child.exited.then((exit) => this.exited(component, exit, generation));
        return component;
    }

    private openInComponents(document: SharedDocument): void {
        for (const component of this.components) {
            if (!component.profile.languages.includes(lspLanguageId(document.languageId)) || component.documents.has(document.absolutePath)) {
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
        return this.components;
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
        if (this.phase !== 'ready') {
            return;
        }
        for (const document of this.documents.values()) {
            this.options.hooks.providers(document);
        }
    }

    private exited(component: Component, exit: LanguageExit, generation: number): void {
        if (generation !== this.generation || !this.components.includes(component)) {
            return;
        }
        const reason = exit.signal ? `was stopped by ${exit.signal}` : `exited with code ${exit.code ?? 'unknown'}`;
        const said = this.log.last('server');
        void this.fail(`The ${component.profile.name} language server ${reason}${said ? `: ${said}` : ''}`);
    }

    private async fail(message: string): Promise<void> {
        const components = this.components;
        this.components = [];
        this.generation++;
        this.phase = 'crashed';
        this.failure = message;
        this.log.push('host', message);
        for (const component of components) {
            component.documents.clear();
            this.release(component);
            component.child.kill('SIGTERM');
        }
        this.notify();
        for (const document of this.documents.values()) {
            this.options.hooks.providers(document);
        }
    }

    private release(component: Component): void {
        for (const subscription of component.subscriptions) {
            subscription.dispose();
        }
        component.subscriptions = [];
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
