import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
    LANGUAGE_ERROR_CODES,
    LANGUAGE_METHODS,
    isPathBelow,
    resolveStoredPath,
    storedPathOf,
    type LanguageCommandResult,
    type LanguageDocumentOpenResult,
    type CustomLanguageServer,
    type CustomLanguageServerInput,
    type LanguageCustomCheckResult,
    type LanguageErrorCode,
    type LanguageLogLine,
    type LanguageMethod,
    type LanguageRequestResult,
    type LanguageServerId,
    type LanguageServerKind,
    type LanguageServerState,
    type LanguageServerStatus
} from '@ruimte/contracts';
import type {
    LanguageCommandPayload,
    LanguageDiagnosticsEvent,
    LanguageDocumentChangePayload,
    LanguageDocumentOpenPayload,
    LanguageDocumentTargetPayload,
    LanguageEditAnswerPayload,
    LanguageMessageAnswerPayload,
    LanguageMessageEvent,
    LanguageRequestPayload,
    LanguageShowEvent,
    LanguageTraceValue,
    LanguageWillSavePayload
} from '@ruimte/contracts';
import { CodedError, fileExists, type WatchSeams } from '@adecore/agents';
import {
    ErrorCodes,
    LspError,
    fileUriToPath,
    pathToFileUri,
    planWorkspaceOperations,
    StaleResultError,
    TextMirror,
    watchesFile,
    type ApplyWorkspaceEditParams,
    type ApplyWorkspaceEditResult,
    type Diagnostic,
    type CreatedFile,
    type DeletedFile,
    type MessageActionItem,
    type RenamedFile,
    type ShowDocumentParams,
    type ShowDocumentResult,
    type ShowMessageRequestParams,
    type WorkspaceEdit,
    type WorkspaceEditPlan,
    type WorkspaceEditSource
} from '@adecore/lsp';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { isDirectory } from '../fs/browse.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { pinnedItem, tagHierarchy } from './hierarchy.ts';
import { LanguageChoices } from './choices.ts';
import { CustomLanguageServers, customProfile } from './custom.ts';
import { ProjectFileWatcher, type FileChange, type StatPath } from './file-watch.ts';
import { LanguageInstaller, type CheckoutRevision } from './installer.ts';
import { findManifests } from './manifests.ts';
import { nativeStorageOf, nativeStubsOf, type Download, type NativePolicy } from './native.ts';
import { MERGED_METHODS, mergeAnswers, mergeProviders } from './merge.ts';
import {
    activates,
    additionKindsForLanguage,
    alongsideKindsForPath,
    alternativesOf,
    CATALOG_KINDS,
    componentServes,
    documentLanguageId,
    KIND_PROFILES,
    kindForLanguage,
    usesVue,
    type CatalogKind,
    type ComponentProfile,
    type KindProfile,
    type ProjectFacts,
    type ProjectSqlSettings
} from './profiles.ts';
import { bunRuntime, runCommand, spawnLanguageProcess, type LanguageRuntime, type RunCommand, type SpawnLanguageProcess } from './runtime.ts';
import {
    LanguageServer,
    levelOf,
    MERGE_DEADLINE_MS,
    realLanguageClock,
    titleOf,
    type LanguageClock,
    type LanguageServerHooks,
    type SharedDocument
} from './server.ts';
import { StorageGate } from './storage-gate.ts';

class LanguageError extends CodedError<LanguageErrorCode> {}

/* How long an agent's call waits for a server of its file to come up, which a project that loads for a while can take. */
const AGENT_READY_MS = 30_000;

/* How long an agent's call waits for the first report of a server that pushes its diagnostics rather than being asked. */
const AGENT_PUSH_MS = 3_000;

/* One file as an agent's call holds it (`LanguageHost.forAgent`). */
export interface AgentDocument {
    storedPath: string;
    absolutePath: string;
    /* The text the servers see. */
    text: string;
    /* Whether a client holds the file open with text that differs from what is on disk. */
    unsaved: boolean;
    servers: Array<{ kind: LanguageServerId; state: LanguageServerState | 'not-installed'; message?: string }>;
    request(method: LanguageMethod, params: object): Promise<LanguageRequestResult>;
    /* What each process last found in the document, after asking those that are asked. */
    diagnostics(): Promise<Array<{ server: string; diagnostics: Diagnostic[] }>>;
}

function isCatalogKind(id: LanguageServerId): id is CatalogKind {
    return id in KIND_PROFILES;
}

/* The wire still names a retired kind (`CatalogKind`), which has nothing to install, go back to or prefer. */
function catalogKindOf(kind: LanguageServerKind): CatalogKind {
    if (!isCatalogKind(kind)) {
        throw new LanguageError(LANGUAGE_ERROR_CODES.invalidServer, `No language server ${kind}`);
    }

    return kind;
}

const HELD_MESSAGE = 'Its command was changed outside Ruimte. Open it and save it again to start it.';

/* Whether a server of a person's own runs for the project: for every project, or for the folders it names. */
function runsFor(server: CustomLanguageServer, folder: string): boolean {
    return server.projects === undefined || server.projects.includes(folder);
}

interface LanguageHostOptions {
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
    /* Where a toolchain's program may be (`LanguageInstallerOptions.findProgram`). */
    findProgram?: (program: string) => string[];
    clock?: LanguageClock;
    exists?: (path: string) => Promise<boolean>;
    isFolder?: (path: string) => Promise<boolean>;
    /* The text of a file, or null when it cannot be read. */
    readText?: (path: string) => Promise<string | null>;
    now?: () => number;
    /* What the project's file watching reaches the platform and the clock through; the system's by default. */
    watch?: { platform?: NodeJS.Platform; seams?: WatchSeams; stat?: StatPath };
    /* The servers of a person's own; by default the file beside the installs. */
    custom?: CustomLanguageServers;
    /* Which server the machine uses where two serve one language; by default the file beside the installs. */
    choices?: LanguageChoices;
    /* Whether a path lies in a folder made from another machine's work, where no server runs the code it holds; none by default. */
    untrusted?: (path: string) => boolean;
    /* Native servers use a selected standalone checkout or the pinned release. */
    native?: NativePolicy;
    /* How an install downloads a release or the stubs. */
    download?: Download;
    /* How the revision of a checkout a native kind builds from is read; git by default. */
    checkoutRevision?: CheckoutRevision;
    /* What the project's SQL comes down to for the servers that read it; without it they start with none. */
    sqlSettings?: (projectId: string) => Promise<ProjectSqlSettings | null>;
}

export interface PhpCache {
    /* `language-servers/php-native/storage`, which holds `cache` and `stubs`. */
    storage: string;
    /* The stubs commits of the current and previous install. */
    keptStubs: string[];
    liveFolders(): string[];
    liveStubsDirs(): string[];
    /* Whether any PHP server runs or is starting, in any project. */
    anyLive(): boolean;
    hold<T>(work: () => Promise<T>): Promise<T>;
}

interface ProjectLanguage {
    projectId: string;
    folder: string;
    documents: Map<string, SharedDocument>;
    servers: Map<LanguageServerId, LanguageServer>;
    /* Whether the project uses Vue, which sends its scripts to the Vue kind; unknown until its `package.json` was read or a `.vue` file opened. */
    vue: boolean | undefined;
    vueCheck: Promise<boolean> | undefined;
    /* Per server, the commands of clients in the order they came. */
    commands: Map<LanguageServer, CommandLine>;
    /* Watches the project's files while a server of it asked to hear about them. */
    watcher: ProjectFileWatcher | null;
}

/*
 * LSP ties no `workspace/applyEdit` to the request that caused it, so a server runs one command at a
 * time and an edit it asks for goes to the client of that command.
 */
interface CommandLine {
    clientId: string | null;
    tail: Promise<void>;
    waiting: number;
}

/* An edit a server asked for and a client has not answered yet. */
interface PendingEdit {
    projectId: string;
    clientId: string;
    settle(result: ApplyWorkspaceEditResult): void;
}

/* The problems a server holds for one file of the project, as a whole-project pull left them. */
export interface WorkspaceProblems {
    server: string;
    path: string;
    absolutePath: string;
    diagnostics: Diagnostic[];
}

/* A `window/showMessageRequest` that waits for a person to pick one of its actions. */
interface PendingMessage {
    projectId: string;
    server: LanguageServer;
    items: readonly MessageActionItem[];
    settle(item: MessageActionItem | null): void;
}

/* How long a client has to say whether it made an edit. */
const EDIT_ANSWER_MS = 30_000;

async function readTextOrNull(path: string): Promise<string | null> {
    return readFile(path, 'utf8').catch(() => null);
}

function withoutItemData(params: object): object {
    const { item } = params as { item: Record<string, unknown> };
    const { data: _data, ...rest } = item;
    return { ...params, item: rest };
}

/* What a file operation leaves to the host: the operation itself (`move`: the move, the create or the delete) and the writing of a file no client holds open. */
export interface FileMove {
    move(): Promise<void>;
    write(path: string, text: string): Promise<void>;
    /* Makes a file that is not there with its text, and fails when it is. */
    create(path: string, text: string): Promise<void>;
    /* Moves a file or folder a server's edit moves; `overwrite` replaces a file that is there. */
    rename(from: string, to: string, overwrite: boolean): Promise<void>;
    /* Deletes a file or folder a server's edit deletes. */
    delete(path: string): Promise<void>;
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
 * only when its project closes, since starting one again for every file opened costs seconds of
 * indexing. Installing happens only through `install`, which a person's request calls, so no verb and
 * no agent reaches it.
 */
export class LanguageHost {
    private readonly options: LanguageHostOptions;
    private readonly installer: LanguageInstaller;
    private readonly custom: CustomLanguageServers;
    private readonly choices: LanguageChoices;
    private readonly clock: LanguageClock;
    private readonly exists: (path: string) => Promise<boolean>;
    private readonly isFolder: (path: string) => Promise<boolean>;
    private readonly sinks = new ClientSinks((clientId) => this.dropClient(clientId));
    private readonly projects = new Map<string, ProjectLanguage>();
    private readonly ending = new Set<ProjectLanguage>();
    private readonly phpGate = new StorageGate();
    private readonly edits = new Map<string, PendingEdit>();
    private editCounter = 0;
    private readonly messages = new Map<string, PendingMessage>();
    private messageCounter = 0;
    /* What an agent's call waits on: a server that comes up or a report that comes in. */
    private readonly waiters = new Set<() => void>();
    private readonly hooks: LanguageServerHooks = {
        status: (server) => {
            this.toHolders(server.projectId, { event: 'language.status', payload: { projectId: server.projectId, status: this.serverStatus(server) } });

            // A prompt of a server that went down has nobody to answer it.
            if (server.state !== 'ready' && server.state !== 'indexing') {
                this.settleMessages((pending) => pending.server === server);
            }

            this.wake();
        },
        workspaceReport: (server, component, uri, diagnostics) => {
            const project = this.projects.get(server.projectId);
            const path = fileUriToPath(uri);

            if (project !== undefined && path !== null) {
                const payload: LanguageDiagnosticsEvent = {
                    projectId: server.projectId,
                    path: storedPathOf(project.folder, path),
                    server: component,
                    diagnostics
                };

                this.toHolders(server.projectId, { event: 'language.diagnostics', payload });
            }
        },
        message: (server, profile, params, request) => this.receiveMessage(server, profile, params, request),
        showDocument: (server, profile, params) => this.showDocumentOf(server, profile, params),
        diagnostics: (document, component, params) => {
            document.reported ??= new Map();
            document.reported.set(component, params.diagnostics);
            this.wake();
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
        this.clock = options.clock ?? realLanguageClock;
        this.exists = options.exists ?? fileExists;
        this.isFolder = options.isFolder ?? isDirectory;
        this.installer = new LanguageInstaller({
            root: options.root,
            runtime: options.runtime ?? bunRuntime(),
            run: options.run ?? runCommand,
            now: options.now,
            native: options.native,
            download: options.download,
            onChange: (kind) => this.installChanged(kind),
            onSwitched: (kind) => this.installSwitched(kind),
            ...(options.checkoutRevision === undefined ? {} : { checkoutRevision: options.checkoutRevision }),
            ...(options.findProgram === undefined ? {} : { findProgram: options.findProgram })
        });
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Reads the servers of a person's own and the machine's choices. Call before a client can ask. */
    async load(): Promise<void> {
        await Promise.all([this.custom.load(), this.choices.load(), this.installer.load()]);
    }

    async status(projectId: string): Promise<LanguageServerStatus[]> {
        // A person looks at the servers here, which is when a checkout that changed since its build is worth knowing about.
        await this.installer.refreshCheckouts();
        const project = this.projects.get(projectId) ?? null;
        const folder = project?.folder ?? this.options.folderOf(projectId);
        const own = folder === null ? [] : this.custom.list().filter((server) => runsFor(server, folder));
        return Promise.all([...CATALOG_KINDS, ...own.map((server) => server.id as LanguageServerId)].map((id) => this.statusOf(project, id)));
    }

    /* Starts installing a kind, or updating it beside what it runs, and answers while it runs; the end comes as a `language.status` event. */
    async install(kind: LanguageServerKind): Promise<LanguageServerStatus> {
        const known = catalogKindOf(kind);
        void this.installer.install(known);
        return this.statusOf(null, known);
    }

    /* What a pass over the PHP server's index caches needs: where they are, what it must leave alone and the gate that keeps a start out meanwhile. */
    phpCache(): PhpCache {
        const storage = nativeStorageOf(this.installer.directoryOf('php-native'));
        const keptStubs = this.installer.keptStubsOf('php-native');
        // A closed project is gone from `projects` while its processes may still be exiting, and its caches stay in use until then.
        const liveProjects = (): { folder: string; server: LanguageServer }[] =>
            [...this.projects.values(), ...this.ending].flatMap((project) => {
                const server = project.servers.get('php-native');

                return server?.live ? [{ folder: project.folder, server }] : [];
            });
        const liveServers = (): LanguageServer[] => liveProjects().map(({ server }) => server);

        return {
            storage,
            keptStubs,
            liveFolders: () => liveProjects().map(({ folder }) => folder),
            // A running server may still read the stubs of the install before the current one.
            liveStubsDirs: () => (liveServers().length === 0 ? [] : keptStubs.map((commit) => nativeStubsOf(this.installer.directoryOf('php-native'), commit))),
            anyLive: () => liveServers().length > 0,
            hold: (work) => this.phpGate.hold(work)
        };
    }

    /* The program a native kind runs on this machine, or null while it is not installed. */
    programOf(kind: CatalogKind): string | null {
        return this.installer.launchOf(kind)?.executable ?? null;
    }

    /* Goes back to the version a kind ran before, which a person asks for when an update does not work for them. */
    async rollback(kind: LanguageServerKind): Promise<LanguageServerStatus> {
        const known = catalogKindOf(kind);
        try {
            await this.installer.rollback(known);
        } catch (error) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.failed, errorText(error));
        }
        const status = await this.statusOf(null, known);
        this.sinks.emit({ event: 'language.status', payload: { projectId: null, status } });
        return status;
    }

    /*
     * The machine uses this server for what it and its alternative both serve. Open documents move to it
     * at once, and the alternative ends when it has none left; clients hear of both through the machine's status.
     */
    async prefer(requested: LanguageServerKind): Promise<LanguageServerStatus> {
        const kind = catalogKindOf(requested);
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
        return await this.openFor(clientId, payload, () => this.sinks.clientIds().includes(clientId));
    }

    /* `holding` says whether the client is still there once the paths are read; an agent's owner always is. */
    private async openFor(clientId: string, payload: LanguageDocumentOpenPayload, holding: () => boolean): Promise<LanguageDocumentOpenResult> {
        const project = this.projectFor(payload.projectId);
        const absolutePath = await this.pathOf(project, payload.path);
        const storedPath = storedPathOf(project.folder, absolutePath);
        const kinds = await this.kindsFor(project, payload.languageId, storedPath);
        // A client that went or a project that ended meanwhile was already cleaned up, and would leave this document behind.
        if (this.projects.get(payload.projectId) !== project) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.projectNotFound, `No project ${payload.projectId}`);
        }
        if (!holding()) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.unavailable, 'The client went away');
        }
        let document = project.documents.get(absolutePath);
        if (document) {
            document.clients.add(clientId);
            if (document.mirror.text !== payload.text) {
                // Two clients with different text take turns: whoever opens last sets what the servers see.
                const changes = [{ text: payload.text }];
                document.mirror.applyChanges(changes);
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
                mirror: new TextMirror(payload.text),
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

    /* A save is about to write the document; the servers that asked hear it, and a failure is theirs to log. */
    async willSave(payload: LanguageWillSavePayload): Promise<void> {
        const { project, document } = this.documentOf(payload);

        await Promise.all(this.servingServers(project, document).map((server) => server.willSave(document, payload.reason)));
    }

    /*
     * A file was written. The servers hear `didSave` only when the text is the one they hold for that
     * document; any other write is not their document's, so nothing is sent.
     */
    async saved(absolutePath: string, text: string): Promise<void> {
        const path = resolve(absolutePath);

        await Promise.all(
            [...this.projects.values()].flatMap((project) => {
                const document = project.documents.get(path);

                if (document === undefined || document.mirror.text !== text) {
                    return [];
                }

                return this.serversOf(project, document).map((server) => server.saved(document));
            })
        );
    }

    async change(payload: LanguageDocumentChangePayload): Promise<{ version: number }> {
        const { project, document } = this.documentOf(payload);
        if (payload.baseVersion !== document.version) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.staleDocument, `The document is at version ${document.version}, not ${payload.baseVersion}`);
        }
        try {
            document.mirror.applyChanges(payload.changes);
        } catch (error) {
            // A change that does not fit the text means the client's text is not the daemon's.
            throw new LanguageError(LANGUAGE_ERROR_CODES.staleDocument, error instanceof Error ? error.message : 'The change does not fit the document');
        }
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
        const servers = this.servingServers(project, document);
        const params = typeof payload.params === 'object' && payload.params !== null ? payload.params : {};
        const pinned = pinnedItem(payload.method, params);
        const pinnedServer = pinned !== null && servers.some((server) => server.hasComponent(pinned.server)) ? pinned.server : undefined;
        // The data of a server that is gone means nothing to the one that answers instead.
        const routed = pinned === null ? params : pinnedServer === undefined ? withoutItemData(pinned.params) : pinned.params;
        try {
            const answer = await this.route(servers, document, payload.method, routed, payload.server ?? pinnedServer);
            return { ...answer, result: tagHierarchy(payload.method, answer.result, answer.server) };
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
                answers.map((answer) => ({ server: answer.server, result: answer.result, itemServers: answer.itemServers })),
                (id, error) => able.find((server) => server.hasComponent(id))?.log.push('host', `Completion default ignored: ${error.message}`)
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
            cancel = this.clock.set(() => {
                server.log.push('host', `Left out of a ${method} answer, which it did not give within ${MERGE_DEADLINE_MS} ms`);
                reject(new LspError(`The ${server.kind} server did not answer ${method} in time`, ErrorCodes.RequestCancelled));
            }, MERGE_DEADLINE_MS);
        });
        return Promise.race([answer, expired]).finally(cancel);
    }

    /* Runs a command of a server for a client, which may be asked to make edits while it runs. */
    async command(clientId: string, payload: LanguageCommandPayload): Promise<LanguageCommandResult> {
        const { project, document } = this.documentOf(payload);
        const servers = this.servingServers(project, document);
        const server =
            (payload.server ? servers.find((candidate) => candidate.hasComponent(payload.server!)) : undefined) ??
            servers.find((candidate) => candidate.canAnswer(document, 'workspace/executeCommand')) ??
            servers[0]!;
        const line = project.commands.get(server) ?? { clientId: null, tail: Promise.resolve(), waiting: 0 };
        project.commands.set(server, line);
        line.waiting++;
        const turn = line.tail.then(async () => {
            if (!this.sinks.clientIds().includes(clientId)) {
                throw new LanguageError(LANGUAGE_ERROR_CODES.unavailable, 'The client went away');
            }
            line.clientId = clientId;
            try {
                return await server.executeCommand(document, payload.command, payload.arguments, payload.server);
            } finally {
                line.clientId = null;
            }
        });
        line.tail = turn
            .catch(() => undefined)
            .then(() => {
                line.waiting--;
                if (line.waiting === 0 && project.commands.get(server) === line) {
                    project.commands.delete(server);
                }
            });
        try {
            return await turn;
        } catch (error) {
            throw translated(error);
        }
    }

    /* A client says whether it made an edit a server asked for. */
    answerEdit(clientId: string, payload: LanguageEditAnswerPayload): void {
        const pending = this.edits.get(payload.editId);
        if (pending && pending.clientId === clientId && pending.projectId === payload.projectId) {
            pending.settle({ applied: payload.applied, ...(payload.failureReason ? { failureReason: payload.failureReason } : {}) });
        }
    }

    /*
     * What the project's SQL comes down to changed: a binding, a connection or where a snapshot is. Every
     * server of the project that reads it is told at once; one that is not running takes it at its start.
     */
    async sqlChanged(projectId: string): Promise<void> {
        const project = this.projects.get(projectId);
        const read = this.options.sqlSettings;
        if (!project || read === undefined) {
            return;
        }
        const readers = [...project.servers.values()].filter((server) => server.readsSettings());
        if (readers.length === 0) {
            return;
        }
        const settings = await read(projectId);
        await Promise.all(readers.map((server) => server.reconfigure(settings)));
    }

    /* Files outside the project folder that the servers of every project may watch changed, such as a schema snapshot the daemon wrote. */
    async outsideFilesChanged(changes: readonly FileChange[]): Promise<void> {
        await Promise.all([...this.projects.values()].flatMap((project) => [...project.servers.values()].map((server) => server.filesChanged(changes))));
    }

    /*
     * One file as an agent asks about it. The daemon joins the document as a client of its own for as long
     * as `work` runs, the way a person opening the file would: a document a client holds keeps the text in
     * its editor, and one nobody holds opens with the text on disk. A server that is installed starts if it
     * has to and is waited on up to `AGENT_READY_MS`; one that is not installed stays so.
     */
    async forAgent<T>(
        projectId: string,
        request: { path: string; languageId: string; disk: string; owner: string },
        work: (document: AgentDocument) => Promise<T>
    ): Promise<T> {
        const project = this.projectFor(projectId);
        const absolutePath = await this.pathOf(project, request.path);
        const storedPath = storedPathOf(project.folder, absolutePath);
        let document = project.documents.get(absolutePath);
        if (document) {
            document.clients.add(request.owner);
        } else {
            await this.openFor(request.owner, { projectId, path: storedPath, languageId: request.languageId, text: request.disk }, () => true);
            document = project.documents.get(absolutePath)!;
        }
        const held = document;
        try {
            const kinds = held.kinds;
            const installed = await Promise.all(kinds.map((kind) => (isCatalogKind(kind) ? this.installer.isInstalled(kind) : Promise.resolve(true))));
            await this.waitFor(
                () =>
                    kinds.every((kind, index) => {
                        const state = project.servers.get(kind)?.state;
                        return !installed[index] || state === 'ready' || state === 'indexing' || state === 'crashed';
                    }),
                AGENT_READY_MS
            );
            const servers = kinds.map((kind, index) => {
                const server = project.servers.get(kind);
                const state: LanguageServerState | 'not-installed' = installed[index] ? (server?.state ?? 'stopped') : 'not-installed';
                return { kind, state, ...(server?.message ? { message: server.message } : {}) };
            });
            return await work({
                storedPath,
                absolutePath,
                text: held.mirror.text,
                unsaved: held.mirror.text !== request.disk,
                servers,
                request: (method, params) => this.request({ projectId, path: storedPath, method, params }),
                diagnostics: () => this.diagnosticsFor(project, held)
            });
        } finally {
            await this.release(project, held, request.owner).catch(() => undefined);
        }
    }

    /* What every running server finds in the document: asked of the ones that are asked, waited on a while for the ones that push. */
    private async diagnosticsFor(project: ProjectLanguage, document: SharedDocument): Promise<Array<{ server: string; diagnostics: Diagnostic[] }>> {
        const servers = this.serversOf(project, document).filter((server) => server.state === 'ready' || server.state === 'indexing');
        await Promise.all(servers.map((server) => server.pullNow(document)));
        const pushers = servers.flatMap((server) => server.pushers(document));
        await this.waitFor(() => pushers.every((name) => document.reported?.has(name) === true), AGENT_PUSH_MS);
        return [...(document.reported?.entries() ?? [])].map(([server, diagnostics]) => ({ server, diagnostics }));
    }

    /* Settles once `done` holds, checked again at every status and report, or once `ms` passed. */
    private waitFor(done: () => boolean, ms: number): Promise<void> {
        if (done()) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            const check = (): void => {
                if (done()) {
                    finish();
                }
            };
            const cancel = this.clock.set(() => finish(), ms);
            const finish = (): void => {
                cancel();
                this.waiters.delete(check);
                resolve();
            };
            this.waiters.add(check);
        });
    }

    private wake(): void {
        for (const waiter of [...this.waiters]) {
            waiter();
        }
    }

    /* The project closed on the machine, which is its last client going: its servers end with it. */
    async end(projectId: string): Promise<void> {
        const project = this.projects.get(projectId);
        if (!project) {
            return;
        }
        this.projects.delete(projectId);
        this.ending.add(project);
        project.watcher?.close();
        project.watcher = null;
        project.documents.clear();

        try {
            await Promise.all([...project.servers.values()].map((server) => server.stop()));
        } finally {
            this.ending.delete(project);
        }
    }

    /* The daemon is going down. */
    async close(): Promise<void> {
        await Promise.all([...this.projects.keys()].map((projectId) => this.end(projectId)));
    }

    private readText(path: string): Promise<string | null> {
        return (this.options.readText ?? readTextOrNull)(path);
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
            commands: new Map(),
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
    private async primaryKindFor(project: ProjectLanguage, kind: CatalogKind | null): Promise<CatalogKind | null> {
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
        const untrusted = this.untrusted(project.folder) || this.untrusted(resolve(project.folder, storedPath));
        if (untrusted) {
            // A server of a person's own may run anything of the folder too, so it stays off there with the catalog's that do.
            return primary === null || KIND_PROFILES[primary].runsProjectCode === true ? [] : [primary];
        }
        if (candidates.length > 0) {
            const facts: ProjectFacts = {
                folder: project.folder,
                packageJson: await this.readText(join(project.folder, 'package.json')),
                exists: this.exists,
                find: (file, depth) => findManifests(project.folder, file, depth)
            };
            const active = await Promise.all(candidates.map(([, needs]) => activates(needs, facts)));
            kinds.push(...candidates.filter((_, index) => active[index]).map(([kind]) => kind));
        }
        return [...kinds, ...this.customKindsFor(project, languageId, storedPath)];
    }

    private untrusted(path: string): boolean {
        return this.options.untrusted?.(path) === true;
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
        project.vueCheck ??= this.readText(join(project.folder, 'package.json')).then((text) => {
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

    /* The same, refused when there are none. */
    private servingServers(project: ProjectLanguage, document: SharedDocument): LanguageServer[] {
        const servers = this.serversOf(project, document);
        if (servers.length === 0) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.unavailable, `No language server serves ${document.languageId}`);
        }
        return servers;
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
                installDirectory: () => (catalog === null ? '' : this.installer.installDirectoryOf(catalog)),
                native: () => (catalog === null ? null : this.installer.launchOf(catalog)),
                isInstalled: () => (catalog === null ? Promise.resolve(true) : this.installer.isInstalled(catalog)),
                ...(kind === 'php-native' ? { beforeSpawn: () => this.phpGate.wait() } : {}),
                runtime: this.options.runtime ?? bunRuntime(),
                spawn: this.options.spawn ?? spawnLanguageProcess,
                clock: this.clock,
                now: this.options.now,
                exists: this.exists,
                readText: this.options.readText,
                ownTypescript: !this.untrusted(project.folder),
                ...(this.options.sqlSettings === undefined ? {} : { sqlSettings: () => this.options.sqlSettings!(project.projectId) }),
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
        const names = isCatalogKind(kind)
            ? KIND_PROFILES[kind].components.filter((component) => component.sidecar !== true).map((component) => component.name)
            : [kind];
        for (const name of names) {
            this.toHolders(project.projectId, {
                event: 'language.diagnostics',
                payload: { projectId: project.projectId, path: document.storedPath, server: name, diagnostics: [] }
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

        // With the last holder gone nobody is left to answer a prompt.
        this.settleMessages((pending) => this.options.holders(pending.projectId).every((holder) => holder === clientId));

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
                    ([1, 2, 3] as const).some((type) => watchesFile(server.watchedFiles(), project.folder, path, type))
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

    /* The edit goes to the client whose command this server runs, which makes it or says why not; a request with no command to answer for is refused. */
    private askForEdit(server: LanguageServer, params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> {
        const clientId = this.projects.get(server.projectId)?.commands.get(server)?.clientId ?? null;
        if (clientId === null) {
            return Promise.resolve({ applied: false, failureReason: 'No command of a client is running' });
        }
        return this.sendEdit(server.projectId, clientId, params.edit, params.label);
    }

    /*
     * A message of a server is always a log line. Only an error or a warning reaches a person, as an
     * event to every client that holds the project; a request also waits for the action they pick.
     * No timer runs on it: the server waits like any client's would.
     */
    private receiveMessage(
        server: LanguageServer,
        profile: ComponentProfile,
        params: ShowMessageRequestParams,
        request: boolean
    ): Promise<MessageActionItem | null> {
        server.log.push('server', params.message, { source: 'message', level: levelOf(params.type) });

        const holders = this.options.holders(server.projectId);

        if (holders.length === 0 || (!request && params.type > 2)) {
            return Promise.resolve(null);
        }

        const messageId = `message-${++this.messageCounter}`;
        const payload: LanguageMessageEvent = {
            projectId: server.projectId,
            messageId,
            server: profile.name,
            title: titleOf(profile),
            type: params.type,
            message: params.message,
            ...(request ? { actions: params.actions?.map((action) => action.title) ?? [] } : {})
        };

        this.toHolders(server.projectId, { event: 'language.message', payload });

        if (!request) {
            return Promise.resolve(null);
        }

        return new Promise<MessageActionItem | null>((resolve) => {
            this.messages.set(messageId, {
                projectId: server.projectId,
                server,
                items: params.actions ?? [],
                settle: (item) => {
                    this.messages.delete(messageId);
                    this.toHolders(server.projectId, { event: 'language.messageClosed', payload: { projectId: server.projectId, messageId } });
                    resolve(item);
                }
            });
        });
    }

    /* A client picked an action of a message request, or dismissed it. The first answer wins; later ones and unknown ids do nothing. */
    answerMessage(payload: LanguageMessageAnswerPayload): void {
        const pending = this.messages.get(payload.messageId);

        if (pending === undefined || pending.projectId !== payload.projectId) {
            return;
        }

        pending.settle(pending.items.find((item) => item.title === payload.action) ?? null);
    }

    private settleMessages(matches: (pending: PendingMessage) => boolean): void {
        for (const pending of [...this.messages.values()]) {
            if (matches(pending)) {
                pending.settle(null);
            }
        }
    }

    /*
     * A server is shown something only while a command of a client runs on it, and only to that client.
     * A file inside the project opens there; an address is offered and never opened, so the answer is no.
     */
    private async showDocumentOf(server: LanguageServer, profile: ComponentProfile, params: ShowDocumentParams): Promise<ShowDocumentResult> {
        const refuse = (reason: string): ShowDocumentResult => {
            server.log.push('host', `${titleOf(profile)} asked to show ${params.uri}, which Ruimte does not open: ${reason}`);

            return { success: false };
        };
        const project = this.projects.get(server.projectId);
        const clientId = project?.commands.get(server)?.clientId ?? null;

        if (project === undefined || clientId === null) {
            return refuse('no command of a client is running');
        }

        let url: URL;

        try {
            url = new URL(params.uri);
        } catch {
            return refuse('it is not an address');
        }

        const base = { projectId: server.projectId, server: profile.name, title: titleOf(profile) };

        if (url.protocol === 'http:' || url.protocol === 'https:') {
            const payload: LanguageShowEvent = { ...base, url: params.uri };

            this.sinks.to(clientId, { event: 'language.show', payload });

            // Nothing was shown yet; a person decides.
            return { success: false };
        }

        if (url.protocol !== 'file:' || params.external === true) {
            return refuse(url.protocol === 'file:' ? 'it asks for an application outside Ruimte' : `${url.protocol} is not opened`);
        }

        const path = fileUriToPath(params.uri);

        if (path === null) {
            return refuse('it is not a file of this machine');
        }

        let stored: string;

        try {
            stored = storedPathOf(project.folder, await this.pathOf(project, path));
        } catch {
            return refuse('the file is not one a client may open');
        }

        if (isAbsolute(stored)) {
            return refuse('the file is outside the project');
        }

        const payload: LanguageShowEvent = { ...base, path: stored, ...(params.selection === undefined ? {} : { selection: params.selection }) };

        this.sinks.to(clientId, { event: 'language.show', payload });

        return { success: true };
    }

    /*
     * Pulls the problems of every file of the project from the servers that offer them. New reports go to
     * every holder as `language.diagnostics`; files a server found unchanged are sent again only to the
     * asking client, which may not have heard them. `reports` carries both, for a caller that reads them.
     */
    async workspaceProblems(clientId: string | null, projectId: string): Promise<{ servers: string[]; files: number; reports: WorkspaceProblems[] }> {
        const project = this.projects.get(projectId);
        const servers: string[] = [];
        const reports: WorkspaceProblems[] = [];
        let files = 0;

        if (project === undefined) {
            return { servers, files, reports };
        }

        const answers = await Promise.all([...project.servers.values()].map((server) => server.workspaceProblems()));

        for (const answer of answers) {
            servers.push(...answer.servers);
            files += answer.files;

            for (const report of answer.reports) {
                const path = fileUriToPath(report.uri);

                if (path === null || report.diagnostics.length === 0) {
                    continue;
                }

                const stored = storedPathOf(project.folder, path);

                reports.push({ server: report.server, path: stored, absolutePath: path, diagnostics: report.diagnostics });

                if (!report.fresh && clientId !== null) {
                    const payload: LanguageDiagnosticsEvent = { projectId, path: stored, server: report.server, diagnostics: report.diagnostics };

                    this.sinks.to(clientId, { event: 'language.diagnostics', payload });
                }
            }
        }

        return { servers, files, reports };
    }

    /* What the last whole-project pull left, for a caller that may not start one. `pulled` is false while a server that offers it never had a pull. */
    cachedWorkspaceProblems(projectId: string): { servers: string[]; pulled: boolean; files: number; reports: WorkspaceProblems[] } {
        const project = this.projects.get(projectId);
        const servers: string[] = [];
        const reports: WorkspaceProblems[] = [];
        let pulled = true;

        if (project === undefined) {
            return { servers, pulled, files: 0, reports };
        }

        for (const server of project.servers.values()) {
            const answer = server.cachedWorkspaceProblems();

            servers.push(...answer.servers);
            pulled &&= answer.pulled;

            for (const report of answer.reports) {
                const path = fileUriToPath(report.uri);

                if (path !== null && report.diagnostics.length > 0) {
                    reports.push({ server: report.server, path: storedPathOf(project.folder, path), absolutePath: path, diagnostics: report.diagnostics });
                }
            }
        }

        return { servers, pulled, files: new Set(reports.map((report) => report.absolutePath)).size, reports };
    }

    /* Switches the trace of a server of the project; any client may, since it only costs log lines. */
    async trace(projectId: string, id: LanguageServerId, value: LanguageTraceValue): Promise<LanguageServerStatus> {
        const project = this.projects.get(projectId) ?? null;
        const server = project?.servers.get(id);

        if (server === undefined) {
            throw new LanguageError(LANGUAGE_ERROR_CODES.unavailable, 'The server is not running in this project');
        }

        await server.setTrace(value);

        return this.statusOf(project, id);
    }

    /* Hands an edit to one client, which makes it in its editors and answers with `language.edit.answer`. */
    private sendEdit(projectId: string, clientId: string, edit: WorkspaceEdit, label?: string): Promise<ApplyWorkspaceEditResult> {
        const editId = `edit-${++this.editCounter}`;
        return new Promise<ApplyWorkspaceEditResult>((resolve) => {
            const cancel = this.clock.set(() => pending.settle({ applied: false, failureReason: 'The client did not answer' }), EDIT_ANSWER_MS);
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
     * Each server of the project says what a move would change (imports, a namespace), which is made before
     * the move, and is told afterwards that the files moved. A slow or failing server is left out and the
     * move still happens; an edit the editor refuses ends it before a file moved. `edits: false` skips the
     * first half, for a caller that moves files as part of an edit it made itself.
     */
    async renameFiles(clientId: string, projectId: string, from: string, to: string, edits: boolean, file: FileMove): Promise<string[]> {
        const moved: RenamedFile = {
            oldUri: pathToFileUri(resolve(from)),
            newUri: pathToFileUri(resolve(to)),
            directory: await isDirectory(from)
        };
        return this.passFilesBy(
            clientId,
            projectId,
            'rename',
            edits,
            file,
            (server, apply) => server.willRenameFiles([moved], apply),
            (server) => server.didRenameFiles([moved])
        );
    }

    /* A file or folder that is made goes past the servers the same way a move does; `file.move` makes it. */
    async createFiles(clientId: string, projectId: string, path: string, directory: boolean, edits: boolean, file: FileMove): Promise<string[]> {
        const made: CreatedFile = { uri: pathToFileUri(resolve(path)), directory };
        return this.passFilesBy(
            clientId,
            projectId,
            'new file',
            edits,
            file,
            (server, apply) => server.willCreateFiles([made], apply),
            (server) => server.didCreateFiles([made])
        );
    }

    /* A file or folder that is deleted goes past the servers the same way a move does; `file.move` deletes it. */
    async deleteFiles(clientId: string, projectId: string, path: string, edits: boolean, file: FileMove): Promise<string[]> {
        const gone: DeletedFile = { uri: pathToFileUri(resolve(path)), directory: await isDirectory(path) };
        return this.passFilesBy(
            clientId,
            projectId,
            'delete',
            edits,
            file,
            (server, apply) => server.willDeleteFiles([gone], apply),
            (server) => server.didDeleteFiles([gone])
        );
    }

    private async passFilesBy(
        clientId: string,
        projectId: string,
        what: string,
        edits: boolean,
        file: FileMove,
        before: (server: LanguageServer, apply: (edit: WorkspaceEdit) => Promise<void>) => Promise<void>,
        after: (server: LanguageServer) => Promise<void>
    ): Promise<string[]> {
        const project = this.projects.get(projectId);
        const edited: string[] = [];
        if (project === undefined) {
            await file.move();
            return edited;
        }
        if (edits) {
            for (const server of project.servers.values()) {
                await before(server, async (edit) => {
                    edited.push(...(await this.applyFileEdit(project, clientId, edit, file, server, what)));
                });
            }
        }
        await file.move();
        await Promise.all([...project.servers.values()].map(after));
        return edited;
    }

    /*
     * Makes what a server answered to a file operation. The whole edit is planned against the files and checked first: one
     * that does not fit is left out whole and logged, and one that would move, replace or delete a document a client holds
     * open is refused. Then the editors take their edits, as one undo step, and only when all accept do the files change on
     * disk, in the planner's order, so a refusal leaves the disk as it was.
     */
    private async applyFileEdit(
        project: ProjectLanguage,
        clientId: string,
        edit: WorkspaceEdit,
        file: FileMove,
        server: LanguageServer,
        what: string
    ): Promise<string[]> {
        let plan: WorkspaceEditPlan;
        try {
            plan = await planWorkspaceOperations(edit, this.editSource(project));
        } catch (error) {
            server.log.push('host', `${server.kind} left out the edit of a ${what}: ${error instanceof Error ? error.message : 'it does not fit the files'}`);
            return [];
        }
        const held = new Map<string, WorkspaceEdit>();
        const edited: string[] = [];
        const onDisk: Array<() => Promise<void>> = [];
        for (const step of plan.steps) {
            if (step.kind === 'edits') {
                if (step.after === step.before) {
                    continue;
                }
                const path = fileUriToPath(step.uri) ?? '';
                edited.push(path);
                const open = this.heldDocument(project, step.uri);
                if (open === undefined) {
                    await this.options.machineHome.refuse(path);
                    onDisk.push(() => file.write(path, step.after));
                    continue;
                }
                const target = open.clients.has(clientId) ? clientId : [...open.clients][0]!;
                const own = held.get(target) ?? { documentChanges: [] };
                own.documentChanges = [...(own.documentChanges ?? []), { textDocument: { uri: open.uri, version: open.version }, edits: [...step.edits] }];
                held.set(target, own);
                continue;
            }
            const paths = step.kind === 'rename' ? [fileUriToPath(step.oldUri) ?? '', fileUriToPath(step.newUri) ?? ''] : [fileUriToPath(step.uri) ?? ''];
            for (const path of paths) {
                if (this.holdsUnder(project, path)) {
                    throw new LanguageError(
                        LANGUAGE_ERROR_CODES.failed,
                        `The edit of a ${what} would move, replace or delete ${path}, which an editor holds open`
                    );
                }
                await this.options.machineHome.refuse(path);
            }
            if (step.kind === 'create') {
                edited.push(paths[0]!);
                onDisk.push(() => (step.overwrite ? file.write(paths[0]!, step.text) : file.create(paths[0]!, step.text)));
            } else if (step.kind === 'rename') {
                onDisk.push(() => file.rename(paths[0]!, paths[1]!, step.overwrite));
            } else {
                onDisk.push(() => file.delete(paths[0]!));
            }
        }
        for (const [target, own] of held) {
            const result = await this.sendEdit(project.projectId, target, own);
            if (!result.applied) {
                throw new LanguageError(LANGUAGE_ERROR_CODES.failed, result.failureReason ?? `The editor did not make the edit of a ${what}`);
            }
        }
        for (const run of onDisk) {
            await run();
        }
        return edited;
    }

    private heldDocument(project: ProjectLanguage, uri: string): SharedDocument | undefined {
        const path = fileUriToPath(uri);
        const document = path === null ? undefined : project.documents.get(path);
        return document !== undefined && document.clients.size > 0 ? document : undefined;
    }

    /* Whether a client holds the file at the path, or a file inside it when it is a folder. */
    private holdsUnder(project: ProjectLanguage, path: string): boolean {
        return [...project.documents.values()].some(
            (document) => document.clients.size > 0 && (document.absolutePath === path || isPathBelow(path, document.absolutePath))
        );
    }

    /* The files an edit is planned against: the editor's text for a document a client holds open, else the disk's. */
    private editSource(project: ProjectLanguage): WorkspaceEditSource {
        return {
            operations: ['create', 'rename', 'delete'],
            read: async (uri) => {
                const open = this.heldDocument(project, uri);
                if (open !== undefined) {
                    return { text: open.mirror.text, version: open.version, open: true };
                }
                const path = fileUriToPath(uri);
                if (path === null) {
                    return null;
                }
                await this.options.machineHome.refuse(path);
                const text = await this.readText(path);
                return text === null ? null : { text, version: null, open: false };
            },
            exists: (uri) => this.askOfPath(uri, this.exists),
            isFolder: (uri) => this.askOfPath(uri, this.isFolder)
        };
    }

    /* What `ask` says of the file a uri names, after the line a file read stops at; false for a uri that names no file. */
    private async askOfPath(uri: string, ask: (path: string) => Promise<boolean>): Promise<boolean> {
        const path = fileUriToPath(uri);
        if (path === null) {
            return false;
        }
        await this.options.machineHome.refuse(path);
        return ask(path);
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
        const kind: CatalogKind = id;
        const install = await this.installer.state(kind);
        const base = this.identityOf(kind);
        if (install === 'installing') {
            return { ...base, state: 'installing', documents: 0 };
        }
        if (install === 'missing') {
            const message = this.installer.failureOf(kind);
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
            ...(sidecars.length > 0 ? { sidecars } : {}),
            ...(server.traceValue === 'off' ? {} : { trace: server.traceValue })
        };
    }

    /* What an install would bring over the version a kind runs, the one before it, and why the last update did not come. */
    private versionsOf(kind: CatalogKind): Pick<LanguageServerStatus, 'update' | 'previous' | 'message'> {
        const update = this.installer.updateOf(kind);
        const previous = this.installer.previousOf(kind);
        const failure = update === null ? null : this.installer.failureOf(kind);
        return {
            ...(update === null ? {} : { update: { version: update.version, ...(update.rebuild ? { rebuild: true } : {}) } }),
            ...(previous === null ? {} : { previous: { version: previous } }),
            ...(failure === null ? {} : { message: failure })
        };
    }

    /* Whether the machine uses the kind, for a kind that has an alternative; nothing for one that has none. */
    private choiceOf(kind: CatalogKind): { chosen?: boolean } {
        const { choice } = KIND_PROFILES[kind];
        return choice === undefined || alternativesOf(kind).length === 0 ? {} : { chosen: kindForLanguage(choice, this.choices.get()) === kind };
    }

    /* The id and version of a server, and for one of a person's own what the client has no catalog entry to say. */
    private identityOf(
        id: LanguageServerId
    ): Pick<LanguageServerStatus, 'server' | 'version' | 'name' | 'languages' | 'patterns' | 'chosen' | 'update' | 'previous' | 'message'> {
        if (isCatalogKind(id)) {
            return { server: id, version: this.installer.versionOf(id), ...this.choiceOf(id), ...this.versionsOf(id) };
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

    /* Gives a document the servers it has now, after a server of a person's own came or went or the machine chose another. */
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
    private installChanged(kind: CatalogKind): void {
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

    /* A kind runs another install now, so every server of it that ran starts again on it. */
    private installSwitched(kind: CatalogKind): void {
        for (const project of this.projects.values()) {
            const server = project.servers.get(kind);
            if (server && server.state !== 'stopped') {
                void server.restart().catch(() => undefined);
            }
        }
    }

    private toHolders(projectId: string, event: SessionEvent): void {
        for (const clientId of this.options.holders(projectId)) {
            this.sinks.to(clientId, event);
        }
    }
}
