import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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
import { CodedError } from '@adecore/agents/coded-error';
import {
    applyContentChanges,
    ErrorCodes,
    LspError,
    fileUriToPath,
    pathToFileUri,
    planWorkspaceEdit,
    StaleResultError,
    watchesFile,
    type ApplyWorkspaceEditParams,
    type ApplyWorkspaceEditResult,
    type DocumentSnapshot,
    type RenamedFile,
    type WorkspaceEdit
} from '@adecore/lsp';
import type { WatchSeams } from '@adecore/agents/watch-seam';
import { ClientSinks } from '../client-sinks.ts';
import { ProjectFileWatcher, type StatPath } from './file-watch.ts';
import { CustomLanguageServers, customProfile } from './custom.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { LanguageChoices } from './choices.ts';
import { LanguageInstaller } from './installer.ts';
import type { Download, NativePolicy } from './native.ts';
import { MERGED_METHODS, mergeAnswers, mergeProviders } from './merge.ts';
import {
    activates,
    additionKindsForLanguage,
    alongsideKindsForPath,
    alternativesOf,
    componentServes,
    documentLanguageId,
    KIND_PROFILES,
    kindForLanguage,
    usesVue,
    type KindProfile,
    type ProjectFacts
} from './profiles.ts';
import { bunRuntime, runCommand, spawnLanguageProcess, type LanguageRuntime, type RunCommand, type SpawnLanguageProcess } from './runtime.ts';
import { LanguageServer, MERGE_DEADLINE_MS, realLanguageClock, type LanguageClock, type LanguageServerHooks, type SharedDocument } from './server.ts';

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
    /* What the project's file watching reaches the platform and the clock through; the system's by default. */
    watch?: { platform?: NodeJS.Platform; seams?: WatchSeams; stat?: StatPath };
    /* The servers of a person's own; by default the file beside the installs. */
    custom?: CustomLanguageServers;
    /* Which server the machine uses where two serve one language; by default the file beside the installs. */
    choices?: LanguageChoices;
    /* Native servers use a selected standalone checkout or the pinned release. */
    native?: NativePolicy;
    /* How an install downloads a release or the stubs. */
    download?: Download;
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
    /* Watches the project's files while a server of it asked to hear about them. */
    watcher: ProjectFileWatcher | null;
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

/* What a move of files leaves to the host: the move itself and the writing of a file no client holds open. */
export interface FileMove {
    move(): Promise<void>;
    write(path: string, text: string): Promise<void>;
    /* Makes a file that is not there with its text, and fails when it is. */
    create(path: string, text: string): Promise<void>;
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
    private readonly choices: LanguageChoices;
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
        watching: (server) => this.syncWatcher(server.projectId),
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
        this.choices = options.choices ?? new LanguageChoices({ path: join(options.root, 'choices.json') });
        this.installer = new LanguageInstaller({
            root: options.root,
            runtime: options.runtime ?? bunRuntime(),
            run: options.run ?? runCommand,
            now: options.now,
            native: options.native,
            download: options.download,
            onChange: (kind) => this.installChanged(kind)
        });
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Reads the servers of a person's own and the machine's choices. Call before a client can ask. */
    async load(): Promise<void> {
        await Promise.all([this.custom.load(), this.choices.load()]);
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

    /*
     * The machine uses this server for what it and its alternative both serve. Open documents move to it
     * at once, and the alternative ends when it has none left; clients hear of both through the machine's status.
     */
    async prefer(kind: LanguageServerKind): Promise<LanguageServerStatus> {
        const alternatives = alternativesOf(kind);
        if (alternatives.length === 0) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.invalidServer, `${kind} has no alternative to choose it over`);
        }
        await this.choices.set(kind);
        for (const project of this.projects.values()) {
            for (const document of project.documents.values()) {
                await this.reroute(project, document);
            }
            for (const other of alternatives) {
                const left = project.servers.get(other);
                if (left && left.documentCount === 0 && left.state !== 'crashed') {
                    await left.stop();
                }
            }
        }
        for (const changed of [...alternatives, kind]) {
            this.sinks.emit({ event: 'language.status', payload: { projectId: null, status: await this.statusOf(null, changed) } });
        }
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
            project.watcher?.addDirectory(dirname(absolutePath));
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
            const [main, ...others] = able;
            const settled = await Promise.allSettled([
                main!.request(document, method, params),
                ...others.map((server) => this.beforeDeadline(server, method, server.request(document, method, params)))
            ]);
            const answers = settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
            if (answers.length === 0) {
                throw (settled[0] as PromiseRejectedResult).reason;
            }
            const merged = mergeAnswers(
                method,
                answers.map((answer) => ({ server: answer.server, result: answer.result, itemServers: answer.itemServers }))
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

    /*
     * A server that has not answered when the deadline passes is left out of a merged answer and its late
     * one dropped, so a slow ESLint or Tailwind never holds up the server of the language, which has no deadline.
     */
    private beforeDeadline<T>(server: LanguageServer, method: string, answer: Promise<T>): Promise<T> {
        let cancel = (): void => undefined;
        const expired = new Promise<never>((_, reject) => {
            cancel = (this.options.clock ?? realLanguageClock).set(() => {
                server.log.push('host', `Left out of a ${method} answer, which it did not give within ${MERGE_DEADLINE_MS} ms`);
                reject(new LspError(`The ${server.kind} server did not answer ${method} in time`, ErrorCodes.RequestCancelled));
            }, MERGE_DEADLINE_MS);
        });
        return Promise.race([answer, expired]).finally(cancel);
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
        project.watcher?.close();
        project.watcher = null;
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
        const project: ProjectLanguage = {
            projectId,
            folder,
            documents: new Map(),
            servers: new Map(),
            vue: undefined,
            vueCheck: undefined,
            commands: [],
            watcher: null
        };
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
        const primary = await this.primaryKindFor(project, kindForLanguage(languageId, this.choices.get(), storedPath));
        const candidates = [
            ...additionKindsForLanguage(languageId).map((kind) => [kind, KIND_PROFILES[kind]] as const),
            ...alongsideKindsForPath(storedPath).filter(([kind]) => kind !== primary)
        ];
        const kinds: LanguageServerId[] = primary === null ? [] : [primary];
        if (candidates.length > 0) {
            const facts: ProjectFacts = {
                folder: project.folder,
                packageJson: await (this.options.readText ?? readTextOrNull)(join(project.folder, 'package.json')),
                exists: this.options.exists ?? fileExists
            };
            const active = await Promise.all(candidates.map(([, needs]) => activates(needs, facts)));
            kinds.push(...candidates.filter((_, index) => active[index]).map(([kind]) => kind));
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
                native: () => (catalog === null ? null : this.installer.launchOf(catalog)),
                isInstalled: () => (catalog === null ? Promise.resolve(true) : this.installer.isInstalled(catalog)),
                runtime: this.options.runtime ?? bunRuntime(),
                spawn: this.options.spawn ?? spawnLanguageProcess,
                clock: this.options.clock ?? realLanguageClock,
                now: this.options.now,
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
        for (const component of (isCatalogKind(kind)
            ? KIND_PROFILES[kind].components.filter((candidate) => candidate.sidecar !== true)
            : [{ name: kind }]) as readonly {
            name: string;
        }[]) {
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

    /* The project's files are watched exactly while some server of it registered to hear about them. */
    private syncWatcher(projectId: string): void {
        const project = this.projects.get(projectId);
        if (!project) {
            return;
        }
        const wanted = [...project.servers.values()].some((server) => server.watchedFiles().length > 0);
        if (!wanted) {
            project.watcher?.close();
            project.watcher = null;
            return;
        }
        if (project.watcher !== null) {
            return;
        }
        const { platform, seams, stat } = this.options.watch ?? {};
        const watcher = new ProjectFileWatcher({
            folder: project.folder,
            platform,
            seams,
            stat,
            wants: (path) =>
                [...project.servers.values()].some((server) =>
                    [1, 2, 3].some((type) => watchesFile(server.watchedFiles(), project.folder, path, type as 1 | 2 | 3))
                ),
            onChanges: (changes) => {
                for (const server of project.servers.values()) {
                    void server.filesChanged(changes);
                }
            }
        });
        for (const document of project.documents.values()) {
            watcher.addDirectory(dirname(document.absolutePath));
        }
        project.watcher = watcher;
    }

    /* The edit goes to the client whose command is running, which makes it or says why not; a request with no command to answer for is refused. */
    private askForEdit(server: LanguageServer, params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> {
        const running = this.projects.get(server.projectId)?.commands.at(-1);
        if (!running) {
            return Promise.resolve({ applied: false, failureReason: 'No command of a client is running' });
        }
        return this.sendEdit(server.projectId, running.clientId, params.edit, params.label);
    }

    /* Hands an edit to one client, which makes it in its editors and answers with `language.edit.answer`. */
    private sendEdit(projectId: string, clientId: string, edit: WorkspaceEdit, label?: string): Promise<ApplyWorkspaceEditResult> {
        const editId = `edit-${++this.editCounter}`;
        return new Promise<ApplyWorkspaceEditResult>((resolve) => {
            const cancel = (this.options.clock ?? realLanguageClock).set(
                () => pending.settle({ applied: false, failureReason: 'The client did not answer' }),
                EDIT_ANSWER_MS
            );
            const pending: PendingEdit = {
                projectId,
                clientId,
                settle: (result) => {
                    cancel();
                    this.edits.delete(editId);
                    resolve(result);
                }
            };
            this.edits.set(editId, pending);
            this.sinks.to(clientId, { event: 'language.edit', payload: { projectId, editId, ...(label ? { label } : {}), edit } });
        });
    }

    /*
     * Files that move go past the servers of the project: each says what it would change first (imports, a
     * namespace), which is made before the move, and is told afterwards that the files moved. A server that is
     * slow or fails is left out, and the move still happens; an edit that cannot be made ends it before a file moved.
     * `edits: false` skips the first half, for a caller that moves files as part of an edit it made itself.
     */
    async renameFiles(clientId: string, projectId: string, from: string, to: string, edits: boolean, file: FileMove): Promise<string[]> {
        const project = this.projects.get(projectId);
        const edited: string[] = [];
        if (project === undefined) {
            await file.move();
            return edited;
        }
        const moved: RenamedFile = {
            oldUri: pathToFileUri(resolve(from)),
            newUri: pathToFileUri(resolve(to)),
            directory: (await stat(from).catch(() => null))?.isDirectory() === true
        };
        if (edits) {
            for (const server of project.servers.values()) {
                await server.willRenameFiles([moved], async (edit) => {
                    edited.push(...(await this.applyRenameEdit(project, clientId, edit, file)));
                });
            }
        }
        await file.move();
        await Promise.all([...project.servers.values()].map((server) => server.didRenameFiles([moved])));
        return edited;
    }

    /*
     * Makes what a server answered to a rename: a file it creates is made first, a document a client holds open takes
     * its edits in its editor, as one undo step, and any other file is written. The edit is tried against every text
     * first, so one that does not fit changes nothing.
     */
    private async applyRenameEdit(project: ProjectLanguage, clientId: string, edit: WorkspaceEdit, file: FileMove): Promise<string[]> {
        const documents = new Map<string, SharedDocument>(
            [...project.documents.values()].filter((document) => document.clients.size > 0).map((document) => [document.uri, document])
        );
        const snapshots = new Map<string, DocumentSnapshot>();
        const creates = new Set((edit.documentChanges ?? []).flatMap((change) => ('kind' in change && change.kind === 'create' ? [change.uri] : [])));
        const uris = new Set([
            ...creates,
            ...(edit.documentChanges ?? []).flatMap((change) => ('textDocument' in change ? [change.textDocument.uri] : [])),
            ...Object.keys(edit.changes ?? {})
        ]);
        for (const uri of uris) {
            const open = documents.get(uri);
            const text = open?.text ?? (await (this.options.readText ?? readTextOrNull)(fileUriToPath(uri) ?? ''));
            if (text === null || text === undefined) {
                // A file the edit creates has no text yet; if it is there all the same, making it fails.
                if (creates.has(uri)) {
                    continue;
                }
                throw new LanguageError(LANGUAGE_ERROR_CODES.failed, `${uri} cannot be read to make the edit of a rename`);
            }
            snapshots.set(uri, { text, version: open?.version ?? null });
        }
        let planned;
        try {
            planned = planWorkspaceEdit(edit, snapshots);
        } catch (error) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.failed, error instanceof Error ? error.message : 'The edit of a rename does not fit the files');
        }
        const held = new Map<string, WorkspaceEdit>();
        const created: Array<{ path: string; text: string }> = [];
        const closed: Array<{ path: string; text: string }> = [];
        const edited: string[] = [];
        for (const change of planned) {
            if (change.text === change.before && change.created !== true) {
                continue;
            }
            const path = fileUriToPath(change.uri) ?? '';
            edited.push(path);
            if (change.created === true) {
                created.push({ path, text: change.text });
                continue;
            }
            const open = documents.get(change.uri);
            if (open === undefined) {
                closed.push({ path, text: change.text });
                continue;
            }
            const target = open.clients.has(clientId) ? clientId : [...open.clients][0]!;
            const entries = (edit.documentChanges ?? []).filter((entry) => 'textDocument' in entry && entry.textDocument.uri === change.uri);
            const own = held.get(target) ?? { documentChanges: [] };
            own.documentChanges = [
                ...(own.documentChanges ?? []),
                ...(entries.length > 0 ? entries : [{ textDocument: { uri: change.uri, version: null }, edits: edit.changes?.[change.uri] ?? [] }])
            ];
            held.set(target, own);
        }
        for (const { path, text } of created) {
            await file.create(path, text);
        }
        for (const [target, own] of held) {
            const result = await this.sendEdit(project.projectId, target, own);
            if (!result.applied) {
                throw new LanguageError(LANGUAGE_ERROR_CODES.failed, result.failureReason ?? 'The editor did not make the edit of a rename');
            }
        }
        for (const { path, text } of closed) {
            await file.write(path, text);
        }
        return edited;
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
        const base = { server: kind, version: this.installer.versionOf(kind), ...this.choiceOf(kind) };
        if (install === 'installing') {
            return { ...base, state: 'installing', documents: 0 };
        }
        if (install === 'missing') {
            const message = this.installer.failureOf(kind) ?? ((await this.installer.isOutdated(kind)) ? OUTDATED_MESSAGE : null);
            return {
                ...base,
                state: 'not-installed',
                documents: project?.servers.get(kind)?.documentCount ?? 0,
                ...(message ? { message } : {}),
                ...(this.installer.isUnavailable(kind) ? { unavailable: true } : {})
            };
        }
        const server = project?.servers.get(kind);
        return server ? this.serverStatus(server) : { ...base, state: 'stopped', documents: 0 };
    }

    private serverStatus(server: LanguageServer): LanguageServerStatus {
        const capabilities = server.capabilities;
        const { sidecars } = server;
        return {
            ...this.identityOf(server.kind),
            state: server.state,
            documents: server.documentCount,
            ...(server.message ? { message: server.message } : {}),
            ...(capabilities ? { capabilities } : {}),
            ...(sidecars.length > 0 ? { sidecars } : {})
        };
    }

    /* Whether the machine uses the kind, for a kind that has an alternative; nothing for one that has none. */
    private choiceOf(kind: LanguageServerKind): { chosen?: boolean } {
        const { choice } = KIND_PROFILES[kind];
        return choice === undefined || alternativesOf(kind).length === 0 ? {} : { chosen: kindForLanguage(choice, this.choices.get()) === kind };
    }

    /* The id and version of a server, and for one of a person's own what the client has no catalog entry to say. */
    private identityOf(id: LanguageServerId): Pick<LanguageServerStatus, 'server' | 'version' | 'name' | 'languages' | 'patterns' | 'chosen'> {
        if (isCatalogKind(id)) {
            return { server: id, version: this.installer.versionOf(id), ...this.choiceOf(id) };
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
