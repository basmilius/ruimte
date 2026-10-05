import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
    LANGUAGE_ERROR_CODES,
    LANGUAGE_METHODS,
    resolveStoredPath,
    storedPathOf,
    type LanguageCommandResult,
    type LanguageDocumentOpenResult,
    type CustomLanguageServer,
    type CustomLanguageServerInput,
    type LanguageCustomCheckResult,
    type LanguageErrorCode,
    type LanguageLogLine,
    type LanguageRequestResult,
    type LanguageServerId,
    type LanguageServerKind,
    type LanguageServerStatus
} from '@ruimte/contracts';
import type {
    LanguageCommandPayload,
    LanguageDiagnosticsEvent,
    LanguageDocumentChangePayload,
    LanguageDocumentOpenPayload,
    LanguageDocumentTargetPayload,
    LanguageEditAnswerPayload,
    LanguageRequestPayload
} from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import {
    applyContentChanges,
    ErrorCodes,
    LspError,
    pathToFileUri,
    StaleResultError,
    type ApplyWorkspaceEditParams,
    type ApplyWorkspaceEditResult
} from '@ruimte/smart-editor-lsp';
import { ClientSinks } from '../client-sinks.ts';
import { CustomLanguageServers, customProfile } from './custom.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { LanguageInstaller } from './installer.ts';
import { MERGED_METHODS, mergeAnswers, mergeProviders } from './merge.ts';
import {
    activates,
    additionKindsForLanguage,
    componentServes,
    documentLanguageId,
    KIND_PROFILES,
    kindForLanguage,
    usesVue,
    type KindProfile,
    type ProjectFacts
} from './profiles.ts';
import { bunRuntime, runCommand, spawnLanguageProcess, type LanguageRuntime, type RunCommand, type SpawnLanguageProcess } from './runtime.ts';
import { LanguageServer, realLanguageClock, type LanguageClock, type LanguageServerHooks, type SharedDocument } from './server.ts';
import { versionOf } from './versions.ts';

export class LanguageError extends CodedError<LanguageErrorCode> {}

const KINDS = Object.keys(KIND_PROFILES) as LanguageServerKind[];

function isCatalogKind(id: LanguageServerId): id is LanguageServerKind {
    return id in KIND_PROFILES;
}

const OUTDATED_MESSAGE = 'The installed version is not the one this version of Ruimte uses. Install it again to update.';

const HELD_MESSAGE = 'Its command was changed outside Ruimte. Open it and save it again to start it.';

/* Whether a server of a person's own runs for the project: for every project, or for the folders it names. */
function runsFor(server: CustomLanguageServer, folder: string): boolean {
    return server.projects === undefined || server.projects.includes(folder);
}

export interface LanguageHostOptions {
    /* `$RUIMTE_HOME/language-servers`. */
    root: string;
    folderOf(projectId: string): string | null;
    /* The clients that have the project open, which hear its diagnostics and statuses. */
    holders(projectId: string): string[];
    /* The line a client's file requests stop at; a file under the machine's own state is refused. */
    machineHome: { refuse(path: string): Promise<void> };
    runtime?: LanguageRuntime;
    spawn?: SpawnLanguageProcess;
    run?: RunCommand;
    clock?: LanguageClock;
    exists?: (path: string) => Promise<boolean>;
    /* The text of a file, or null when it cannot be read. */
    readText?: (path: string) => Promise<string | null>;
    now?: () => number;
    /* The servers of a person's own; by default the file beside the installs. */
    custom?: CustomLanguageServers;
}

interface ProjectLanguage {
    projectId: string;
    folder: string;
    documents: Map<string, SharedDocument>;
    servers: Map<LanguageServerId, LanguageServer>;
    /* Whether the project uses Vue, which sends its scripts to the Vue kind; unknown until its `package.json` was read or a `.vue` file opened. */
    vue: boolean | undefined;
    vueCheck: Promise<boolean> | undefined;
    /* The clients whose command is running, newest last: the one a server's request for an edit goes to. */
    commands: Array<{ clientId: string }>;
}

/* An edit a server asked for and a client has not answered yet. */
interface PendingEdit {
    projectId: string;
    clientId: string;
    settle(result: ApplyWorkspaceEditResult): void;
}

/* How long a client has to say whether it made an edit. */
const EDIT_ANSWER_MS = 30_000;

async function readTextOrNull(path: string): Promise<string | null> {
    return readFile(path, 'utf8').catch(() => null);
}

async function fileExists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false
    );
}

/* What a failure of the LSP client is on the wire. */
function translated(error: unknown): unknown {
    if (error instanceof StaleResultError) {
        return new LanguageError(LANGUAGE_ERROR_CODES.staleDocument, error.message);
    }
    if (error instanceof LspError) {
        const code =
            error.code === ErrorCodes.ServerNotInitialized
                ? LANGUAGE_ERROR_CODES.unavailable
                : error.code === ErrorCodes.MethodNotFound
                  ? LANGUAGE_ERROR_CODES.unsupported
                  : error.code === ErrorCodes.RequestCancelled
                    ? LANGUAGE_ERROR_CODES.cancelled
                    : LANGUAGE_ERROR_CODES.failed;
        return new LanguageError(code, error.message);
    }
    return error;
}

/*
 * The language side of the daemon. It is the LSP client of every server, one per project per kind,
 * and the one owner of each document's text and version, so any number of clients share what a
 * server sees. A server starts when a document that needs it opens (and it is installed), and ends
 * only when its project closes, since starting one again for every file opened costs seconds of indexing. Installing happens only through `install`, which
 * a person's request calls, so no verb and no agent reaches it.
 */
export class LanguageHost {
    private readonly options: LanguageHostOptions;
    private readonly installer: LanguageInstaller;
    private readonly custom: CustomLanguageServers;
    private readonly sinks = new ClientSinks((clientId) => this.dropClient(clientId));
    private readonly projects = new Map<string, ProjectLanguage>();
    private readonly edits = new Map<string, PendingEdit>();
    private editCounter = 0;
    private readonly hooks: LanguageServerHooks = {
        status: (server) =>
            this.toHolders(server.projectId, { event: 'language.status', payload: { projectId: server.projectId, status: this.serverStatus(server) } }),
        diagnostics: (document, component, params) => {
            const projectId = this.projectOf(document);
            if (projectId !== null) {
                const payload: LanguageDiagnosticsEvent = { projectId, path: document.storedPath, server: component, diagnostics: params.diagnostics };
                if (params.version !== undefined) {
                    payload.version = params.version;
                }
                this.toHolders(projectId, { event: 'language.diagnostics', payload });
            }
        },
        applyEdit: (server, params) => this.askForEdit(server, params),
        providers: (document) => {
            const projectId = this.projectOf(document);
            const project = projectId === null ? undefined : this.projects.get(projectId);
            if (projectId !== null && project) {
                this.toHolders(projectId, {
                    event: 'language.providers',
                    payload: { projectId, path: document.storedPath, providers: this.providersOf(project, document) }
                });
            }
        }
    };

    constructor(options: LanguageHostOptions) {
        this.options = options;
        this.custom = options.custom ?? new CustomLanguageServers({ path: join(options.root, 'custom.json') });
        this.installer = new LanguageInstaller({
            root: options.root,
            runtime: options.runtime ?? bunRuntime(),
            run: options.run ?? runCommand,
            now: options.now,
            onChange: (kind) => this.installChanged(kind)
        });
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Reads the servers of a person's own. Call before a client can ask. */
    load(): Promise<void> {
        return this.custom.load();
    }

    async status(projectId: string): Promise<LanguageServerStatus[]> {
        const project = this.projects.get(projectId) ?? null;
        const folder = project?.folder ?? this.options.folderOf(projectId);
        const own = folder === null ? [] : this.custom.list().filter((server) => runsFor(server, folder));
        return Promise.all([...KINDS, ...own.map((server) => server.id as LanguageServerId)].map((id) => this.statusOf(project, id)));
    }

    /* Starts installing a kind and answers while it runs; the end comes as a `language.status` event. */
    async install(kind: LanguageServerKind): Promise<LanguageServerStatus> {
        void this.installer.install(kind);
        return this.statusOf(null, kind);
    }

    /* Ends the processes of the kind in the project and starts them again. A crashed kind leaves crashed that way only. */
    async restart(projectId: string, id: LanguageServerId): Promise<LanguageServerStatus> {
        const project = this.projects.get(projectId) ?? null;
        await project?.servers.get(id)?.restart();
        return this.statusOf(project, id);
    }

    async log(projectId: string, id: LanguageServerId): Promise<LanguageLogLine[]> {
        const server = this.projects.get(projectId)?.servers.get(id);
        return [...(isCatalogKind(id) ? this.installer.logOf(id).tail() : []), ...(server?.log.tail() ?? [])].sort((a, b) => a.at - b.at);
    }

    customList(): CustomLanguageServer[] {
        return this.custom.list();
    }

    customCheck(command: string): LanguageCustomCheckResult {
        return this.custom.check(command);
    }

    /* A person's save: it approves starting what the server names, and a document that waits for it gets it now. */
    async customSave(input: CustomLanguageServerInput): Promise<CustomLanguageServer> {
        const saved = await this.custom.save(input);
        await this.customChanged(saved.id);
        return saved;
    }

    async customRemove(id: string): Promise<void> {
        if (await this.custom.remove(id)) {
            await this.customChanged(id);
        }
    }

    async open(clientId: string, payload: LanguageDocumentOpenPayload): Promise<LanguageDocumentOpenResult> {
        const project = this.projectFor(payload.projectId);
        const absolutePath = await this.pathOf(project, payload.path);
        const storedPath = storedPathOf(project.folder, absolutePath);
        const kinds = await this.kindsFor(project, payload.languageId, storedPath);
        let document = project.documents.get(absolutePath);
        if (document) {
            document.clients.add(clientId);
            if (document.text !== payload.text) {
                // Two clients with different text take turns: whoever opens last sets what the servers see.
                const changes = [{ text: payload.text }];
                document.text = payload.text;
                document.version++;
                await Promise.all(this.serversOf(project, document).map((server) => server.change(document!, changes)));
            }
        } else {
            document = {
                absolutePath,
                uri: pathToFileUri(absolutePath),
                kinds,
                storedPath,
                languageId: documentLanguageId(payload.languageId, storedPath),
                text: payload.text,
                version: 1,
                clients: new Set([clientId])
            };
            project.documents.set(absolutePath, document);
            for (const kind of kinds) {
                this.ensureServer(project, kind).attach(document);
            }
        }
        return { version: document.version, servers: [...document.kinds], providers: this.providersOf(project, document) };
    }

    async change(payload: LanguageDocumentChangePayload): Promise<{ version: number }> {
        const { project, document } = this.documentOf(payload);
        if (payload.baseVersion !== document.version) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.staleDocument, `The document is at version ${document.version}, not ${payload.baseVersion}`);
        }
        let next: string;
        try {
            next = applyContentChanges(document.text, payload.changes);
        } catch (error) {
            // A change that does not fit the text means the client's text is not the daemon's.
            throw new LanguageError(LANGUAGE_ERROR_CODES.staleDocument, error instanceof Error ? error.message : 'The change does not fit the document');
        }
        document.text = next;
        const version = ++document.version;
        await Promise.all(this.serversOf(project, document).map((server) => server.change(document, payload.changes)));
        return { version };
    }

    async closeDocument(clientId: string, payload: LanguageDocumentTargetPayload): Promise<void> {
        const found = this.findDocument(payload);
        if (found) {
            await this.release(found.project, found.document, clientId);
        }
    }

    async request(payload: LanguageRequestPayload): Promise<LanguageRequestResult> {
        const { project, document } = this.documentOf(payload);
        if (payload.version !== undefined && payload.version !== document.version) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.staleDocument, `The document is at version ${document.version}, not ${payload.version}`);
        }
        const servers = this.serversOf(project, document);
        if (servers.length === 0) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.unavailable, `No language server serves ${document.languageId}`);
        }
        const params = typeof payload.params === 'object' && payload.params !== null ? payload.params : {};
        try {
            return await this.route(servers, document, payload.method, params, payload.server);
        } catch (error) {
            throw translated(error);
        }
    }

    /*
     * A resolve or a command goes to the process that made it. A feature that adds up goes to every
     * server that offers it, and any other to the first, the one of the document's language before
     * the additions.
     */
    private async route(
        servers: readonly LanguageServer[],
        document: SharedDocument,
        method: string,
        params: object,
        hint?: string
    ): Promise<LanguageRequestResult> {
        if (hint) {
            const owner = servers.find((server) => server.hasComponent(hint));
            if (!owner) {
                throw new LspError(`No ${hint} server serves this document`, ErrorCodes.MethodNotFound);
            }
            return owner.request(document, method, params, hint);
        }
        const able = servers.filter((server) => server.canAnswer(document, method, params));
        if (MERGED_METHODS.has(method) && able.length > 1) {
            const settled = await Promise.allSettled(able.map((server) => server.request(document, method, params)));
            const answers = settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
            if (answers.length === 0) {
                throw (settled[0] as PromiseRejectedResult).reason;
            }
            const merged = mergeAnswers(
                method,
                answers.map((answer) => ({ server: answer.server, result: answer.result }))
            );
            return {
                result: merged.result,
                server: answers[0]!.server,
                version: answers[0]!.version,
                ...(merged.itemServers ? { itemServers: merged.itemServers } : {})
            };
        }
        // With nothing able to answer, the first server says why not: it is down, or it does not do that.
        return (able[0] ?? servers[0]!).request(document, method, params);
    }

    /* Runs a command of a server for a client, which may be asked to make edits while it runs. */
    async command(clientId: string, payload: LanguageCommandPayload): Promise<LanguageCommandResult> {
        const { project, document } = this.documentOf(payload);
        const servers = this.serversOf(project, document);
        if (servers.length === 0) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.unavailable, `No language server serves ${document.languageId}`);
        }
        const server =
            (payload.server ? servers.find((candidate) => candidate.hasComponent(payload.server!)) : undefined) ??
            servers.find((candidate) => candidate.canAnswer(document, 'workspace/executeCommand')) ??
            servers[0]!;
        const running = { clientId };
        project.commands.push(running);
        try {
            return await server.executeCommand(document, payload.command, payload.arguments, payload.server);
        } catch (error) {
            throw translated(error);
        } finally {
            project.commands.splice(project.commands.indexOf(running), 1);
        }
    }

    /* A client says whether it made an edit a server asked for. */
    answerEdit(clientId: string, payload: LanguageEditAnswerPayload): void {
        const pending = this.edits.get(payload.editId);
        if (pending && pending.clientId === clientId && pending.projectId === payload.projectId) {
            pending.settle({ applied: payload.applied, ...(payload.failureReason ? { failureReason: payload.failureReason } : {}) });
        }
    }

    /* The project closed on the machine, which is its last client going: its servers end with it. */
    async end(projectId: string): Promise<void> {
        const project = this.projects.get(projectId);
        if (!project) {
            return;
        }
        this.projects.delete(projectId);
        project.documents.clear();
        await Promise.all([...project.servers.values()].map((server) => server.stop()));
    }

    /* The daemon is going down. */
    async close(): Promise<void> {
        await Promise.all([...this.projects.keys()].map((projectId) => this.end(projectId)));
    }

    private projectFor(projectId: string): ProjectLanguage {
        const existing = this.projects.get(projectId);
        if (existing) {
            return existing;
        }
        const folder = this.options.folderOf(projectId);
        if (folder === null) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.projectNotFound, `No project ${projectId}`);
        }
        const project: ProjectLanguage = { projectId, folder, documents: new Map(), servers: new Map(), vue: undefined, vueCheck: undefined, commands: [] };
        this.projects.set(projectId, project);
        return project;
    }

    /*
     * The kind that serves a document. In a project that uses Vue the scripts go to the Vue kind, whose
     * one TypeScript server loads Vue's plugin, so a `.ts` file importing a `.vue` one is typed and only one
     * tsserver runs. A `.vue` file opening in a project that did not say so makes it one.
     */
    private async primaryKindFor(project: ProjectLanguage, kind: LanguageServerKind | null): Promise<LanguageServerKind | null> {
        if (kind === 'vue') {
            await this.markVue(project);
            return 'vue';
        }
        return kind === 'typescript' && (await this.projectUsesVue(project)) ? 'vue' : kind;
    }

    /* The kinds that serve a document: the one of its language, then the additions the project calls for. */
    private async kindsFor(project: ProjectLanguage, languageId: string, storedPath: string): Promise<LanguageServerId[]> {
        const primary = await this.primaryKindFor(project, kindForLanguage(languageId));
        const candidates = additionKindsForLanguage(languageId);
        const kinds: LanguageServerId[] = primary === null ? [] : [primary];
        if (candidates.length > 0) {
            const facts: ProjectFacts = {
                folder: project.folder,
                packageJson: await (this.options.readText ?? readTextOrNull)(join(project.folder, 'package.json')),
                exists: this.options.exists ?? fileExists
            };
            const active = await Promise.all(candidates.map((kind) => activates(KIND_PROFILES[kind], facts)));
            kinds.push(...candidates.filter((_, index) => active[index]));
        }
        return [...kinds, ...this.customKindsFor(project, languageId, storedPath)];
    }

    /* The servers of a person's own that run for the project and serve the document; one that is held never does. */
    private customKindsFor(project: ProjectLanguage, languageId: string, storedPath: string): LanguageServerId[] {
        return this.custom
            .list()
            .filter((server) => server.held !== true && runsFor(server, project.folder))
            .filter((server) => customProfile(server).components.some((component) => componentServes(component, languageId, storedPath)))
            .map((server) => server.id as LanguageServerId);
    }

    private projectUsesVue(project: ProjectLanguage): Promise<boolean> {
        if (project.vue !== undefined) {
            return Promise.resolve(project.vue);
        }
        project.vueCheck ??= (this.options.readText ?? readTextOrNull)(join(project.folder, 'package.json')).then((text) => {
            project.vue ??= usesVue(text);
            return project.vue;
        });
        return project.vueCheck;
    }

    /* The scripts already open go to the Vue server, and the TypeScript one ends with its last document. */
    private async markVue(project: ProjectLanguage): Promise<void> {
        if (project.vue === true) {
            return;
        }
        project.vue = true;
        const typescript = project.servers.get('typescript');
        const moved = [...project.documents.values()].filter((document) => document.kinds.includes('typescript'));
        for (const document of moved) {
            await typescript?.detach(document);
            document.kinds = document.kinds.map((kind) => (kind === 'typescript' ? 'vue' : kind));
            this.ensureServer(project, 'vue').attach(document);
        }
        if (typescript && moved.length > 0 && typescript.documentCount === 0 && typescript.state !== 'crashed') {
            await typescript.stop();
        }
    }

    /* Where a stored path leads, after the same line a file read stops at. */
    private async pathOf(project: ProjectLanguage, storedPath: string): Promise<string> {
        const resolved = resolveStoredPath(project.folder, storedPath);
        if (resolved === null) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.badPath, `${storedPath} cannot be resolved`);
        }
        const absolutePath = resolve(resolved);
        try {
            await this.options.machineHome.refuse(absolutePath);
        } catch (error) {
            if (error instanceof CodedError) {
                throw new LanguageError(LANGUAGE_ERROR_CODES.badPath, error.message);
            }
            throw error;
        }
        return absolutePath;
    }

    private findDocument(target: LanguageDocumentTargetPayload): { project: ProjectLanguage; document: SharedDocument } | null {
        const project = this.projects.get(target.projectId);
        const resolved = project ? resolveStoredPath(project.folder, target.path) : null;
        const document = project && resolved !== null ? project.documents.get(resolve(resolved)) : undefined;
        return project && document ? { project, document } : null;
    }

    private documentOf(target: LanguageDocumentTargetPayload): { project: ProjectLanguage; document: SharedDocument } {
        const found = this.findDocument(target);
        if (!found) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.documentNotOpen, `${target.path} is not open`);
        }
        return found;
    }

    /* The servers of the document that exist in the project, the one of its language first. */
    private serversOf(project: ProjectLanguage, document: SharedDocument): LanguageServer[] {
        return document.kinds.flatMap((kind) => project.servers.get(kind) ?? []);
    }

    private providersOf(project: ProjectLanguage, document: SharedDocument): Record<string, unknown> {
        return mergeProviders(this.serversOf(project, document).map((server) => server.providers(document, LANGUAGE_METHODS)));
    }

    private ensureServer(project: ProjectLanguage, kind: LanguageServerId): LanguageServer {
        let server = project.servers.get(kind);
        if (!server) {
            const catalog = isCatalogKind(kind) ? kind : null;
            const profile = this.profileOf(kind);
            if (profile === null) {
                throw new LanguageError(LANGUAGE_ERROR_CODES.invalidServer, `No language server ${kind}`);
            }
            server = new LanguageServer({
                kind,
                profile,
                projectId: project.projectId,
                folder: project.folder,
                installDirectory: catalog === null ? '' : this.installer.directoryOf(catalog),
                isInstalled: () => (catalog === null ? Promise.resolve(true) : this.installer.isInstalled(catalog)),
                runtime: this.options.runtime ?? bunRuntime(),
                spawn: this.options.spawn ?? spawnLanguageProcess,
                clock: this.options.clock ?? realLanguageClock,
                exists: this.options.exists ?? fileExists,
                readText: this.options.readText,
                hooks: this.hooks
            });
            project.servers.set(kind, server);
        }
        return server;
    }

    /* One client lets go of a document and the last one closes it. The server stays, so switching between files never starts it again. */
    private async release(project: ProjectLanguage, document: SharedDocument, clientId: string): Promise<void> {
        document.clients.delete(clientId);
        if (document.clients.size > 0) {
            return;
        }
        project.documents.delete(document.absolutePath);
        // A server clears what it reported for a file it was told closed, but no report of it reaches the clients once the file is out of the project's documents.
        for (const kind of document.kinds) {
            this.clearDiagnostics(project, document, kind);
        }
        await Promise.all(this.serversOf(project, document).map((server) => server.detach(document)));
    }

    /* The server of a kind is gone from the document, so what it reported is too. */
    private clearDiagnostics(project: ProjectLanguage, document: SharedDocument, kind: LanguageServerId): void {
        for (const component of (isCatalogKind(kind) ? KIND_PROFILES[kind].components : [{ name: kind }]) as readonly { name: string }[]) {
            this.toHolders(project.projectId, {
                event: 'language.diagnostics',
                payload: { projectId: project.projectId, path: document.storedPath, server: component.name, diagnostics: [] }
            });
        }
    }

    private profileOf(id: LanguageServerId): KindProfile | null {
        if (isCatalogKind(id)) {
            return KIND_PROFILES[id];
        }
        const server = this.custom.get(id);
        return server === undefined ? null : customProfile(server);
    }

    private dropClient(clientId: string): void {
        for (const pending of this.edits.values()) {
            if (pending.clientId === clientId) {
                pending.settle({ applied: false, failureReason: 'The client went away' });
            }
        }
        for (const project of this.projects.values()) {
            for (const document of [...project.documents.values()]) {
                if (document.clients.has(clientId)) {
                    void this.release(project, document, clientId).catch(() => undefined);
                }
            }
        }
    }

    /* The edit goes to the client whose command is running, which makes it or says why not; a request with no command to answer for is refused. */
    private askForEdit(server: LanguageServer, params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> {
        const running = this.projects.get(server.projectId)?.commands.at(-1);
        if (!running) {
            return Promise.resolve({ applied: false, failureReason: 'No command of a client is running' });
        }
        const editId = `edit-${++this.editCounter}`;
        return new Promise<ApplyWorkspaceEditResult>((resolve) => {
            const cancel = (this.options.clock ?? realLanguageClock).set(
                () => pending.settle({ applied: false, failureReason: 'The client did not answer' }),
                EDIT_ANSWER_MS
            );
            const pending: PendingEdit = {
                projectId: server.projectId,
                clientId: running.clientId,
                settle: (result) => {
                    cancel();
                    this.edits.delete(editId);
                    resolve(result);
                }
            };
            this.edits.set(editId, pending);
            this.sinks.to(running.clientId, {
                event: 'language.edit',
                payload: { projectId: server.projectId, editId, ...(params.label ? { label: params.label } : {}), edit: params.edit }
            });
        });
    }

    private projectOf(document: SharedDocument): string | null {
        for (const project of this.projects.values()) {
            if (project.documents.get(document.absolutePath) === document) {
                return project.projectId;
            }
        }
        return null;
    }

    private async statusOf(project: ProjectLanguage | null, id: LanguageServerId): Promise<LanguageServerStatus> {
        if (!isCatalogKind(id)) {
            return this.customStatus(project, id);
        }
        const kind = id;
        const install = await this.installer.state(kind);
        const base = { server: kind, version: versionOf(kind) };
        if (install === 'installing') {
            return { ...base, state: 'installing', documents: 0 };
        }
        if (install === 'missing') {
            const message = this.installer.failureOf(kind) ?? ((await this.installer.isOutdated(kind)) ? OUTDATED_MESSAGE : null);
            return { ...base, state: 'not-installed', documents: project?.servers.get(kind)?.documentCount ?? 0, ...(message ? { message } : {}) };
        }
        const server = project?.servers.get(kind);
        return server ? this.serverStatus(server) : { ...base, state: 'stopped', documents: 0 };
    }

    private serverStatus(server: LanguageServer): LanguageServerStatus {
        const capabilities = server.capabilities;
        return {
            ...this.identityOf(server.kind),
            state: server.state,
            documents: server.documentCount,
            ...(server.message ? { message: server.message } : {}),
            ...(capabilities ? { capabilities } : {})
        };
    }

    /* The id and version of a server, and for one of a person's own what the client has no catalog entry to say. */
    private identityOf(id: LanguageServerId): Pick<LanguageServerStatus, 'server' | 'version' | 'name' | 'languages' | 'patterns'> {
        if (isCatalogKind(id)) {
            return { server: id, version: versionOf(id) };
        }
        const own = this.custom.get(id);
        return { server: id, version: '', name: own?.name ?? id, languages: own?.languages ?? [], patterns: own?.patterns ?? [] };
    }

    private customStatus(project: ProjectLanguage | null, id: LanguageServerId): LanguageServerStatus {
        const own = this.custom.get(id);
        if (own?.held) {
            return { ...this.identityOf(id), state: 'crashed', documents: 0, message: HELD_MESSAGE };
        }
        const server = project?.servers.get(id);
        return server ? this.serverStatus(server) : { ...this.identityOf(id), state: 'stopped', documents: 0 };
    }

    /*
     * A server of a person's own was saved or removed. Every client hears of the list, a server that ran
     * is stopped so the next one starts with what was saved, and each open document takes the servers
     * it has now, so a saved server starts for the file in front of the person.
     */
    private async customChanged(id: string): Promise<void> {
        this.sinks.emit({ event: 'language.custom.changed', payload: { servers: this.custom.list() } });
        for (const project of this.projects.values()) {
            const old = project.servers.get(id as LanguageServerId);
            if (old) {
                project.servers.delete(id as LanguageServerId);
                await old.stop();
            }
            for (const document of project.documents.values()) {
                if (document.kinds.includes(id as LanguageServerId)) {
                    document.kinds = document.kinds.filter((kind) => kind !== id);
                    this.clearDiagnostics(project, document, id as LanguageServerId);
                }
                await this.reroute(project, document);
            }
            this.toHolders(project.projectId, {
                event: 'language.status',
                payload: { projectId: project.projectId, status: await this.statusOf(project, id as LanguageServerId) }
            });
        }
    }

    /* Gives a document the servers it has now, which are not the ones it opened with when a server of a person's own was added or removed. */
    private async reroute(project: ProjectLanguage, document: SharedDocument): Promise<void> {
        const next = await this.kindsFor(project, document.languageId, document.storedPath);
        const added = next.filter((kind) => !document.kinds.includes(kind));
        const removed = document.kinds.filter((kind) => !next.includes(kind));
        for (const kind of removed) {
            await project.servers.get(kind)?.detach(document);
            this.clearDiagnostics(project, document, kind);
        }
        document.kinds = next;
        for (const kind of added) {
            this.ensureServer(project, kind).attach(document);
        }
        this.hooks.providers(document);
    }

    /* An install began or ended. Every client hears of it, since it is the machine's; a project with documents waiting then starts. */
    private installChanged(kind: LanguageServerKind): void {
        void (async () => {
            this.sinks.emit({ event: 'language.status', payload: { projectId: null, status: await this.statusOf(null, kind) } });
            if ((await this.installer.state(kind)) !== 'installed') {
                return;
            }
            for (const project of this.projects.values()) {
                const server = project.servers.get(kind);
                if (server) {
                    void server.ensureStarted().catch(() => undefined);
                }
            }
        })().catch(() => undefined);
    }

    private toHolders(projectId: string, event: SessionEvent): void {
        for (const clientId of this.options.holders(projectId)) {
            this.sinks.to(clientId, event);
        }
    }
}
