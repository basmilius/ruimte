import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
    DEFAULT_PROJECT_COLOR,
    EMPTY_LOCAL,
    projectSidebarViews,
    type ProjectSidebarResult,
    EMPTY_PRIVATE_FILE,
    PROJECT_PRIVATE_VERSION,
    PROJECT_VERSION,
    ProjectDocumentSchema,
    UNKNOWN_KIND,
    duplicateIdIn,
    isCanvasView,
    mergeFiles,
    migrateLocal,
    splitContent,
    type ProjectCloseResult,
    type ProjectClosingResult,
    type ProjectContent,
    type ProjectDocument,
    type ProjectIconChoice,
    type ProjectLocal,
    type ProjectNodeOverlay,
    type ProjectOpenPayload,
    type ProjectOpenResult,
    type ProjectSetIconPayload,
    type ProjectSetIdentityPayload,
    type ProjectSharedFile,
    type SharedFileRead,
    type ProjectSummary,
    type ProjectView
} from '@ruimte/contracts';
import { revisionConflictMessage } from '@ruimte/actions';
import { fileExists, isNotFound, writeAtomic, SYSTEM_WATCH, type DirectoryWatcher, type WatchSeams, KeyedSerializer, Serializer } from '@adecore/agents';
import type { SessionSink } from '../sessions/manager.ts';
import {
    diagramsDirOf,
    documentPathInFolder,
    drawingsDirOf,
    gitignorePathOf,
    fromPortable,
    parseSharedFile,
    privateDirOf,
    privatePathOf,
    readPrivateFile,
    readSharedFile,
    serializePrivateFile,
    serializeSharedFile,
    toPortable,
    tooNewMessage,
    writeGitignoreIfMissing,
    writePrivateFile,
    PROJECT_FILE,
    WATCH_SETTLE_MS
} from './project-files.ts';
import { PROJECT_WRITE_IO, ProjectWriteRaced, ProjectWriteStuck, recoverProjectWrite, writeProjectFiles, type ProjectWriteIO } from './project-write.ts';
import { ProjectHolds } from './project-holds.ts';
import { moveDesignFolders, settleDesignFolders, takenDesignFolders, type DesignAtWork, type DesignSides } from './design-folders.ts';
import { placesOf, ProjectIndex, type IndexedPlace } from './project-index.ts';
import { HiddenAgentStore } from '../agents/hidden-agents.ts';
import { readIdeaName } from './project-identity.ts';
import { ProjectError } from './project-error.ts';
import { ProjectRegistry, type RegistryEntry } from './project-registry.ts';
import { isIconFile, sameIcon, ProjectSummaries } from './project-summaries.ts';
import { splitLegacy, type LoadedFiles, type TrackedProbe } from './legacy-split.ts';
import { errorText } from '../error-text.ts';
import { ClientSinks } from '../client-sinks.ts';
import { scratchFolderOf } from './scratch-project.ts';
import { folderToOpen } from './folder-to-open.ts';
import { isDirectory } from '../fs/browse.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { PeerLinks, withHiddenCanvases } from '../peering/links.ts';
import { RemoteStore, idsOf, machinesOf, withBoundMachines, withMachines, withoutMachines } from '../remote/remote-store.ts';

function asProjectError(e: unknown): unknown {
    if (e instanceof ProjectWriteRaced) {
        return new ProjectError('rev-conflict', e.message);
    }
    return e instanceof ProjectWriteStuck ? new ProjectError('project-invalid', e.message) : e;
}

/* The overlay the private file holds now, whose entries a shared view of a kind this version does not know keeps. */
async function keptOverlayOf(path: string): Promise<Record<string, ProjectNodeOverlay>> {
    const read = await readPrivateFile(privatePathOf(path), { setAside: false }).catch(() => null);
    return read?.kind === 'ok' ? read.document.overlay : {};
}

function newId(): string {
    return randomBytes(6).toString('base64url');
}

function documentOf(content: ProjectContent, rev: number, shared: string[]): ProjectDocument {
    return { version: PROJECT_VERSION, rev, ...content, shared };
}

function identityChanged(entry: RegistryEntry, content: ProjectContent): boolean {
    return content.name !== entry.name || content.color !== entry.color || !sameIcon(content.icon ?? null, entry.icon ?? null);
}

/*
 * What a store of view files (the drawings, the diagrams) needs to hear from this one. It is an
 * interface rather than the class so the files do not import each other.
 */
export interface ProjectViewFiles {
    /* Which views own its files. */
    readonly noun: 'drawing' | 'diagram';
    /* Deletes every file whose view is not in `keep`. The project need not be open, so its file's path comes along. */
    removeOrphans(projectId: string, documentPath: string, keep: Set<string>): Promise<void>;
    closeProject(projectId: string): void;
}

export interface ProjectPlace {
    documentPath: string;
    views: ProjectView[];
    shared: string[];
}

/* What the store needs of the launches: they may start with a project and they end with it. */
export interface ProjectLaunches {
    opened(projectId: string): void;
    running(projectId: string): number;
    /* Ends every launch of the project and says how many still ran. */
    end(projectId: string): Promise<number>;
}

/* What the store needs of the language servers: they end with the project. */
export interface ProjectLanguage {
    end(projectId: string): Promise<void>;
}

/* What the store needs of the database connections: they let go of a project when it does, and forget it when it is deleted. */
interface ProjectDatabases {
    closeProject(projectId: string): void;
    forgetProject(projectId: string): Promise<void>;
}

/* What the store needs of the shared templates: they let go of a project when it does. */
interface ProjectTemplates {
    closeProject(projectId: string): void;
}

/* What the store needs of the provenance records: they go with the project. */
interface ProjectProvenance {
    forget(projectId: string): Promise<void>;
}

/* What judging a binding takes of this machine: who it is, and whether a node already started anything here. */
interface ProjectBindings {
    machineId: string;
    /* A live session or chat, a chat record or a lineage record of this node on this machine. */
    started(nodeId: string): Promise<boolean>;
}

/* What a change hands back: the whole new content, and whatever the caller wants to answer with. */
export interface ProjectMutation<T> {
    /* Null when nothing changed, which is what a dry run leaves behind: it runs every check under
       the same lock a write takes, so what it answers is what the write would have done. */
    content: ProjectContent | null;
    result: T;
    /* The node fields the private file keeps one person's after this write; absent leaves the list as it was. */
    overlayFields?: readonly string[];
    /*
     * Nodes this change adds that run on another machine, by node id to the daemon id of that machine:
     * the daemon's own way to bind one, since a verb's content never carries `machine`. Refused for a node
     * on a canvas that is shared. Bound before the write, like a person's save, so no client starts the node here.
     */
    bindMachines?: ReadonlyMap<string, string>;
    /* Runs once the document is on disk and before `project.changed` goes out, so what a new node
       needs beside the file exists before a client mounts it, and never for a change that was refused. */
    landed?: () => Promise<void>;
}

/* What a change reads of the document besides its content. */
interface MutationContext {
    overlayFields: readonly string[];
}

export type MutationApply<T> = (content: ProjectContent, context: MutationContext) => ProjectMutation<T> | Promise<ProjectMutation<T>>;

interface OpenProject {
    entry: RegistryEntry;
    rev: number;
    /* The exact text last written or read of the shared file, so the watcher can tell our own write
       from someone else's. The private file has no watcher: nothing but this daemon writes it. */
    lastText: string;
    lastPrivate: string;
    // The node fields the private file keeps one person's, which a write has to hand to the split again.
    overlayFields: string[];
    // The views that live in the shared file, which is what a save has to be told to change.
    shared: string[];
    watcher: DirectoryWatcher | null;
    cancelSettle: (() => void) | null;
    // The burst that is settling touched an icon file, so the folder has to be read again.
    iconTouched: boolean;
    // The drawing and diagram views of the document as it stands, so an orphan file can be told from a live one.
    drawingIds: Set<string>;
    diagramIds: Set<string>;
    // The document as last read from disk, until a write or an outside edit makes it stale.
    current: CurrentDocument | null;
}

interface CurrentDocument {
    rev: number;
    content: ProjectContent;
    shared: string[];
}

/* Ends the session behind one node, handed over by the daemon so the store stays out of the managers. */
type SessionEnder = (kind: 'terminal' | 'chat', nodeId: string) => Promise<void>;

/* Told what a person's save changed, with the views as they were before it and as it wrote them. */
type SaveListener = (folder: string, before: readonly ProjectView[], after: readonly ProjectView[]) => Promise<void>;

/* What the store tells or asks of the services beside it, every one handed over when the store is made. */
export interface ProjectLinks {
    tracked: TrackedProbe;
    /* The store knows which sessions a project holds; the managers know how to stop one. */
    endSession: SessionEnder;
    /* Only `save` tells it, which only a client's `project.save` calls: a verb, a watcher or a pull never does. */
    personSaved: SaveListener;
    launches: ProjectLaunches;
    language: ProjectLanguage;
    provenance: ProjectProvenance;
    databases: ProjectDatabases;
    templates: ProjectTemplates;
    bindings: ProjectBindings;
    /* The stores of drawing and diagram files, which are made from this one and so are asked for when a write or a release reaches them. */
    viewFiles(): readonly ProjectViewFiles[];
    /* Whether a chat is in a turn or runs work beside it, and so may still write to a design folder that moved; nothing is without it. */
    chatWorking?(chatId: string): boolean;
    /* The last window closed this project and its sessions are about to end; told while the index still places them. */
    closing?(name: string, nodeIds: readonly string[]): void;
}

/* A view of a kind this daemon does not know may own a file under either folder, so it counts as live for both. */
function viewIdsIn(views: readonly ProjectView[], kind: 'drawing' | 'diagram'): Set<string> {
    return new Set(views.filter((view) => view.kind === kind || view.kind === UNKNOWN_KIND).map((view) => view.id));
}

/* Takes in a write or read of both files, so the watcher can tell the next outside edit from this one. */
function remember(
    state: OpenProject,
    written: { text: string; private: string },
    rev: number,
    shared: readonly string[],
    views: ProjectView[],
    overlayFields: readonly string[] = state.overlayFields
): void {
    state.lastText = written.text;
    state.lastPrivate = written.private;
    state.overlayFields = [...overlayFields];
    state.rev = rev;
    state.shared = [...shared];
    state.drawingIds = viewIdsIn(views, 'drawing');
    state.diagramIds = viewIdsIn(views, 'diagram');
    state.current = null;
}

/* Projects live in `<folder>/.ruimte/project.json`. Machine state stays out of the shared file. */
export class ProjectStore {
    readonly home: string;
    readonly scratchFolder: string;
    /* Every known project's last document, which outlives `release`: the sessions of a project keep running after a client lets go of it. */
    readonly index: ProjectIndex;
    readonly hiddenAgents: HiddenAgentStore;
    /* Which node runs on another machine. It rides on the wire as `machine` and is never written to a project file. */
    readonly remote: RemoteStore;
    /* Which other machines work in which project here, and so which canvases are theirs. */
    readonly peers: PeerLinks;
    private readonly sinks = new ClientSinks((clientId) => this.dropClient(clientId));
    private readonly open = new Map<string, OpenProject>();
    /* Which client has which project on screen. Only those hear `project.changed` and `project.showView`;
       every other client hears a change of the document as the rows of its sidebar (`announceChange`). */
    private readonly holds = new ProjectHolds();
    private readonly registry: ProjectRegistry;
    private readonly summaries: ProjectSummaries;
    // One project's reads and writes run one after the other, and never wait on another project's.
    private readonly projectLocks = new KeyedSerializer();
    // Opening by folder decides which project a folder is, so two opens of one new folder never make two.
    private readonly opens = new Serializer();

    // A folder a client names to open stops at the machine's own state, as its file requests do.
    private readonly machineHome: MachineHome;
    private readonly links: ProjectLinks;
    private readonly seams: WatchSeams;
    private readonly writeIO: ProjectWriteIO;

    constructor(home: string, links: ProjectLinks, seams: WatchSeams = SYSTEM_WATCH, writeIO: ProjectWriteIO = PROJECT_WRITE_IO) {
        this.home = home;
        this.hiddenAgents = new HiddenAgentStore(home);
        this.remote = new RemoteStore(home);
        this.peers = new PeerLinks(home);
        this.index = new ProjectIndex(this.hiddenAgents);
        this.scratchFolder = scratchFolderOf(home);
        this.registry = new ProjectRegistry(home);
        this.machineHome = new MachineHome(home);
        this.summaries = new ProjectSummaries(this.scratchFolder);
        this.links = links;
        this.seams = seams;
        this.writeIO = writeIO;
    }

    /*
     * Both files of a project as one document. The shared file is the one a team commits; the
     * private one holds the rest, the rev and the sidebar order. A file from version 1 or 2 is split
     * on the way in (`splitLegacy`).
     */
    private async loadFiles(
        path: string,
        entry: RegistryEntry,
        read: { file: ProjectSharedFile; legacyRev: number | null } | null,
        readOnly = false
    ): Promise<LoadedFiles> {
        const fallback = { name: entry.name, color: entry.color };
        if (read !== null && read.legacyRev !== null) {
            const split = await splitLegacy(path, { file: read.file, legacyRev: read.legacyRev }, fallback, this.links.tracked);
            if (split !== null) {
                return split;
            }
        }
        const privatePath = privatePathOf(path);
        // A read-only caller must not set a broken file aside, so it refuses instead.
        const outcome = await readPrivateFile(privatePath, { setAside: !readOnly });
        if (outcome.kind === 'unreadable') {
            throw new ProjectError('project-invalid', `${privatePath} does not parse as a private project file`);
        }
        if (outcome.kind === 'invalid' || outcome.kind === 'too-new') {
            const why = outcome.kind === 'invalid' ? outcome.message : tooNewMessage('private project file', outcome.version, PROJECT_PRIVATE_VERSION);
            throw new ProjectError('project-invalid', why);
        }
        const file = outcome.kind === 'ok' ? outcome.document : EMPTY_PRIVATE_FILE;
        const merged = mergeFiles(read?.file ?? null, file, fallback);
        return {
            content: merged.content,
            shared: merged.shared,
            overlayFields: merged.overlayFields,
            rev: file.rev,
            privateText: outcome.kind === 'ok' ? outcome.text : null
        };
    }

    /*
     * Another project that places an id of these views and is open on this machine, Recent being the
     * only place a project is closed. Its sessions may run with no client holding it, so being loaded
     * here is not what counts.
     */
    private holderOfIds(projectId: string, views: readonly ProjectView[], entries: readonly RegistryEntry[]): RegistryEntry | null {
        const open = entries.filter((candidate) => candidate.projectId !== projectId && candidate.closedAt == null);
        for (const id of placesOf(views).keys()) {
            const placing = this.index.projectsPlacing(id);
            const holder = open.find((candidate) => placing.includes(candidate.projectId));
            if (holder) {
                return holder;
            }
        }
        return null;
    }

    /*
     * Writes whichever of the two files changed. The shared one is left alone when its text is what
     * is already there, so moving a private node never shows up in anybody's git status.
     */
    private async writeFiles(
        path: string,
        content: ProjectContent,
        shared: readonly string[],
        rev: number,
        moved: readonly string[],
        overlayFields: readonly string[]
    ): Promise<{ text: string; private: string }> {
        const split = splitContent(content, shared, rev, overlayFields, await keptOverlayOf(path));
        const sharedText = serializeSharedFile(split.shared);
        const privateText = serializePrivateFile(split.private);
        await writeProjectFiles(path, { text: sharedText, private: privateText }, moved, shared, this.writeIO).catch((e: unknown) => {
            throw asProjectError(e);
        });
        return { text: sharedText, private: privateText };
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /*
     * This client put the project on screen, which is what makes it one `showView` reaches. Opening it starts its
     * autostart launches; a hold that is not a person opening it does not.
     */
    hold(clientId: string, projectId: string, options: { startsLaunches?: boolean } = {}): void {
        this.holds.add(clientId, projectId);
        if (options.startsLaunches !== false) {
            this.links.launches.opened(projectId);
        }
    }

    /*
     * This client switched away or its socket went. The project is only let go of when nobody else
     * has it open, since the watcher and the loaded document are shared by everyone holding it.
     */
    letGo(clientId: string, projectId: string): void {
        if (this.holds.remove(clientId, projectId)) {
            this.release(projectId);
        }
    }

    private dropClient(clientId: string): void {
        for (const projectId of this.holds.dropClient(clientId)) {
            this.release(projectId);
        }
    }

    holdersOf(projectId: string): string[] {
        return this.holds.clientsOf(projectId);
    }

    /* The folders of the projects this client has on screen, which is as far as a save from it may reach. */
    async heldFolders(clientId: string): Promise<string[]> {
        const held = new Set(this.holds.projectsOf(clientId));
        return (await this.registry.load()).filter((entry) => held.has(entry.projectId)).map((entry) => entry.folder);
    }

    /* What closing would do, for the confirmation that asks before it. */
    closing(clientId: string, projectId: string): ProjectClosingResult {
        const otherClients = this.holds.others(clientId, projectId);
        return { sessions: otherClients > 0 ? 0 : this.index.sessionNodes(projectId).length + this.links.launches.running(projectId), otherClients };
    }

    /* Every project in the registry, without opening or resolving anything: what a folder is called
       and which project it is, for whoever has a path in hand and wants the name that goes with it. */
    async known(): Promise<{ projectId: string; name: string; folder: string }[]> {
        return (await this.registry.load()).map((entry) => ({ projectId: entry.projectId, name: entry.name, folder: entry.folder }));
    }

    /* Reading the list makes nothing: a daemon nobody has opened a project on answers an empty list,
       and a client that has just paired with one is not handed a project it never asked for. */
    async list(): Promise<ProjectSummary[]> {
        const entries = await this.registry.load();
        return Promise.all(entries.map((entry) => this.summaries.summarize(entry)));
    }

    async sidebar(): Promise<ProjectSidebarResult> {
        const summaries = (await this.list()).filter((summary) => summary.closedAt == null);
        const projects = await Promise.all(
            summaries.map(async (summary) => {
                try {
                    const { content, shared } = await this.locked(summary.projectId, () => this.currentOf(summary.projectId, true));
                    return { summary, views: projectSidebarViews(content.views, shared, content.flags) };
                } catch {
                    // One missing or newer project must not hide the other projects on this machine.
                    return { summary, views: null };
                }
            })
        );
        return { projects };
    }

    openProject(payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        return this.opens.run(() => this.openUnlocked(payload));
    }

    private async openUnlocked(payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        const entries = await this.registry.load();
        let entry: RegistryEntry | undefined;
        // Only a folder the daemon never saw before may take its name from `.idea/.name`.
        let firstOpen = false;
        if (payload.projectId) {
            entry = entries.find((candidate) => candidate.projectId === payload.projectId);
            if (!entry) {
                throw new ProjectError('project-not-found', `No project ${payload.projectId}`);
            }
        } else if (payload.folder) {
            const folder = folderToOpen(payload.folder);
            await this.machineHome.refuse(folder);
            /* Nothing is ever created over something that is already there: a file in the way falls
               through to the check below, which says so in the sentence written for it. */
            if (payload.createFolder && !(await fileExists(folder))) {
                try {
                    await mkdir(folder, { recursive: true });
                } catch (e) {
                    throw new ProjectError('folder-create-failed', `${folder} could not be created: ${e instanceof Error ? e.message : 'unknown error'}`);
                }
            }
            if (!(await isDirectory(folder))) {
                throw new ProjectError('folder-not-found', `${folder} is not a folder`);
            }
            const known = entries.find((candidate) => candidate.folder === folder);
            firstOpen = !known;
            entry = known ?? {
                projectId: newId(),
                name: payload.name ?? basename(folder),
                color: payload.color ?? DEFAULT_PROJECT_COLOR,
                folder,
                lastOpenedAt: Date.now()
            };
        } else {
            throw new ProjectError('project-invalid', 'A project id or folder is required');
        }
        const found = entry;
        return this.locked(found.projectId, () => this.openEntry(found, firstOpen, payload));
    }

    private async openEntry(found: RegistryEntry, firstOpen: boolean, payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        let entry = found;
        const path = this.documentPath(entry);
        await this.recover(entry);
        let outcome = await readSharedFile(path);
        if (outcome.kind === 'invalid') {
            throw new ProjectError('project-invalid', outcome.message);
        }
        if (outcome.kind === 'too-new') {
            throw new ProjectError('project-too-new', tooNewMessage('project', outcome.version, PROJECT_VERSION));
        }
        if (outcome.kind === 'corrupt') {
            console.warn(`Set aside a canvas that would not parse: ${outcome.setAside}`);
            outcome = { kind: 'missing' };
        }
        const missing = outcome.kind !== 'ok';
        if (missing && payload.projectId) {
            throw new ProjectError('project-missing', `The project file of ${entry.name} is missing from ${entry.folder}`);
        }
        // The one moment `.idea/.name` counts: it seeds the file, and the file owns the name from here.
        if (missing && firstOpen && !payload.name) {
            entry = { ...entry, name: (await readIdeaName(entry.folder)) ?? entry.name };
        }
        const loaded = await this.loadFiles(path, entry, outcome.kind === 'ok' ? outcome.document : null);
        const content = missing ? { name: entry.name, color: entry.color, views: [] } : loaded.content;
        // A file that is not there says nothing about the nodes it had, so only a document that was read prunes.
        if (!missing) {
            await this.remote.prune(entry.projectId, idsOf(content));
        }
        const holder = this.holderOfIds(entry.projectId, content.views, await this.registry.load());
        if (holder) {
            throw new ProjectError(
                'project-ids-taken',
                `${holder.name} (${holder.folder}) is open on this machine with the same canvas, which another copy of one repository carries; close it before opening ${entry.folder}, or the two would share their terminals and chats`
            );
        }
        let text = outcome.kind === 'ok' ? outcome.text : '';
        let privateText = loaded.privateText ?? '';
        /* A folder that has no private file yet is one this daemon never wrote: a fresh project, a
           clone of a repository with a canvas in it, or a version-2 file this open is splitting. */
        if (missing || loaded.privateText === null) {
            const written = await this.writeFiles(path, toPortable(content, entry.folder), loaded.shared, loaded.rev, [], loaded.overlayFields);
            text = written.text;
            privateText = written.private;
        }
        await writeGitignoreIfMissing(path);
        const document = documentOf(content, loaded.rev, loaded.shared);

        // Opening is what takes a project back out of Recent, wherever the open came from.
        const opened: RegistryEntry = {
            ...entry,
            name: document.name,
            color: document.color,
            icon: document.icon ?? null,
            lastOpenedAt: Date.now(),
            closedAt: null
        };
        entry = opened;
        await this.registry.update((entries) => [...entries.filter((candidate) => candidate.projectId !== opened.projectId), opened]);
        // Every other client lists it too: a project new to this machine, or one moving to the top.
        this.publish(entry);

        this.release(entry.projectId);
        await this.settleDesigns(entry.projectId, entry.folder, { views: document.views, shared: document.shared ?? [] });
        const daemonSide = this.fromDisk(entry.projectId, document, entry.folder);
        this.index.set(entry.projectId, entry.folder, daemonSide);
        const state: OpenProject = {
            entry,
            rev: document.rev,
            lastText: text,
            lastPrivate: privateText,
            overlayFields: loaded.overlayFields,
            shared: loaded.shared,
            watcher: null,
            cancelSettle: null,
            iconTouched: false,
            drawingIds: viewIdsIn(document.views, 'drawing'),
            diagramIds: viewIdsIn(document.views, 'diagram'),
            current: null
        };
        this.open.set(entry.projectId, state);
        this.startWatching(state, path);

        // Opening a project is the moment to look at the folder again, whatever the cache holds.
        this.summaries.invalidate(entry.folder);
        return {
            summary: await this.summaries.summarize(entry),
            document: this.onTheWire(entry.projectId, daemonSide),
            local: await this.readLocal(entry.projectId)
        };
    }

    /*
     * The project in a folder the daemon owns, made from `seed` when the registry or the folder lacks
     * it. A folder that went missing comes back under the project id it had. Nothing is opened or
     * held: whoever wants it on screen opens it like any other project.
     */
    ensureProject(folder: string, seed: { name: string; icon: ProjectIconChoice }): Promise<ProjectSummary> {
        return this.opens.run(async () => {
            const known = (await this.registry.load()).find((candidate) => candidate.folder === folder);
            const projectId = known?.projectId ?? newId();
            return this.locked(projectId, async () => {
                if (known) {
                    await this.recover(known);
                    if (await fileExists(this.documentPath(known))) {
                        return this.summaries.summarize(known);
                    }
                }
                await mkdir(folder, { recursive: true });
                const entry: RegistryEntry = known ?? {
                    projectId,
                    name: seed.name,
                    color: DEFAULT_PROJECT_COLOR,
                    folder,
                    lastOpenedAt: Date.now(),
                    closedAt: null,
                    icon: seed.icon
                };
                const path = this.documentPath(entry);
                const loaded = await this.loadFiles(path, entry, null);
                const content: ProjectContent = { name: entry.name, color: entry.color, icon: entry.icon ?? seed.icon, views: [] };
                const written = await this.writeFiles(path, toPortable(content, folder), [], loaded.rev, [], loaded.overlayFields);
                await writeGitignoreIfMissing(path);
                const state = this.open.get(entry.projectId);
                if (state) {
                    remember(state, written, loaded.rev, [], [], loaded.overlayFields);
                }
                this.index.set(entry.projectId, folder, content);
                if (!known) {
                    await this.registry.update((entries) => [...entries, entry]);
                    this.publish(entry);
                }
                return this.summaries.summarize(entry);
            });
        });
    }

    /* `origin` is the client that sent the save: it already holds the document, and every other client is told. */
    save(projectId: string, baseRev: number, content: ProjectContent, shared?: readonly string[], origin: string | null = null): Promise<number> {
        return this.locked(projectId, () => this.saveUnlocked(projectId, baseRev, content, shared, origin));
    }

    private async saveUnlocked(
        projectId: string,
        baseRev: number,
        content: ProjectContent,
        shared: readonly string[] | undefined,
        origin: string | null
    ): Promise<number> {
        const state = this.require(projectId);
        if (baseRev !== state.rev) {
            throw new ProjectError('rev-conflict', `The canvas is at rev ${state.rev}, the save was based on ${baseRev}`);
        }
        const duplicate = duplicateIdIn(content.views);
        if (duplicate) {
            throw new ProjectError('project-invalid', `The save would give two things the id "${duplicate}"`);
        }
        await this.refuseOverOutsideEdit(state);
        // What the machine held until now; a project it has open is always indexed, and an index it lacks sets nothing.
        const before = this.index.viewsOf(projectId);
        /* Only a person's save moves a view between the two files. A payload without a list leaves
           the folder as it is, which is what an older client and every other writer amount to. */
        const ids = [...(shared ?? state.shared)];
        this.refuseBoundViews(projectId, content);
        await this.refuseBadBindings(projectId, content);
        this.refuseSharedRemoteNodes(projectId, content, ids);
        // The views that changed sides, so their drawing or diagram file can follow them over.
        const moved = [...new Set([...ids, ...state.shared])].filter((id) => ids.includes(id) !== state.shared.includes(id));
        // A client from before flags sends none and would otherwise take every flag away.
        const flags = content.flags ?? this.index.flagsOf(projectId);
        // A client never sends the SQL choices, which only `language.sql.bind` changes, so a save keeps them.
        const sql = content.sql ?? this.index.sqlOf(projectId);
        const portable = toPortable({ ...content, ...(flags ? { flags } : {}), ...(sql ? { sql } : {}) }, state.entry.folder);
        const document: ProjectDocument = { version: PROJECT_VERSION, rev: state.rev + 1, ...portable, shared: ids };
        /* Bound first: a document that names a node before its binding exists would let a client start it here.
           A save that names no machine for a node leaves its binding as it was, so a client that never heard of the field cannot drop it. */
        const sharedBefore = [...state.shared];
        await this.refuseTakenDesignFolders(state.entry.folder, { views: before ?? [], shared: sharedBefore }, { views: document.views, shared: ids });
        const boundBefore = { ...this.remote.nodesOf(projectId) };
        await this.remote.bind(projectId, machinesOf(content), idsOf(content));
        const written = await this.writeFiles(this.documentPath(state.entry), portable, ids, document.rev, moved, state.overlayFields).catch(
            async (error: unknown) => {
                await this.remote.restore(projectId, boundBefore);
                throw error;
            }
        );
        remember(state, written, document.rev, ids, document.views);
        await this.followDesigns(projectId, state.entry.folder, { views: before ?? [], shared: sharedBefore }, { views: document.views, shared: ids });
        await this.remote.prune(projectId, idsOf(content));
        /* Not the sender: its screen is already ahead of this document, and taking it in would undo a
           drag that went on while the save was out. */
        await this.afterWrite(
            state.entry,
            before ?? [],
            document,
            async (daemonSide) => {
                await this.links.personSaved(state.entry.folder, before ?? daemonSide.views, daemonSide.views);
                if (identityChanged(state.entry, content)) {
                    state.entry = { ...state.entry, name: content.name, color: content.color, icon: content.icon ?? null };
                    await this.replaceEntry(state.entry);
                    this.publish(state.entry);
                }
            },
            origin
        );
        return document.rev;
    }

    /* Before a write: a design that changes sides must not land on a folder that is there already, or two designs would share it. */
    private async refuseTakenDesignFolders(folder: string, before: DesignSides, after: DesignSides): Promise<void> {
        const [taken] = await takenDesignFolders(folder, before, after);
        if (taken !== undefined) {
            throw new ProjectError(
                'design-folder-taken',
                `"${taken.name}" cannot move its pages to ${taken.to}, because another design already has a folder there. Nothing was saved.`
            );
        }
    }

    /* Whether a chat of the design other than `except` may still write to the folder it was told. */
    private designAtWork(except: string | null = null): DesignAtWork {
        return (design) => design.chats.some((chat) => chat.id !== except && this.links.chatWorking?.(chat.id) === true);
    }

    /* A folder a move left on the wrong side goes back to where the document says its design is; one that cannot only says so. */
    private async settleDesigns(projectId: string, folder: string, sides: DesignSides, atWork = this.designAtWork()): Promise<void> {
        await settleDesignFolders(folder, sides, atWork).catch((e: unknown) => {
            console.warn(`Putting back the folders of the designs of project ${projectId} failed:`, errorText(e));
        });
    }

    /*
     * After a turn of a chat ended: what a chat of a design wrote to the folder its design left while
     * that turn ran goes into the folder the design has now, since its CLI hears of the move only at its
     * next turn.
     */
    async settleDesignsAfterTurn(chatId: string): Promise<void> {
        for (const projectId of this.index.projectsPlacing(chatId)) {
            await this.locked(projectId, async () => {
                const folder = this.index.folderOf(projectId);
                const sides = this.index.designSidesOf(projectId);

                if (folder !== null && sides !== null) {
                    await this.settleDesigns(projectId, folder, sides, this.designAtWork(chatId));
                }
            });
        }
    }

    /* A design's folder follows its design between the two sides once the files say where it is; a folder that cannot follow only says so. */
    private async followDesigns(projectId: string, folder: string, before: DesignSides, after: DesignSides): Promise<void> {
        await moveDesignFolders(folder, before, after, this.designAtWork())
            .then((stuck) => stuck.forEach((id) => console.warn(`The folder of design ${id} is on both sides of the project and stayed where it was`)))
            .catch((e: unknown) => console.warn(`Moving the folders of the designs of project ${projectId} failed:`, errorText(e)));
    }

    /* Where a node or a view sits, from the index of every known project: an open one would miss an agent whose person switched away. */
    locate(id: string): IndexedPlace | null {
        return this.index.locate(id);
    }

    /* The machine a node runs on when it is not this one, for whoever would start, show or read it here. */
    machineOfNode(nodeId: string): string | null {
        for (const projectId of this.index.projectsPlacing(nodeId)) {
            const machine = this.remote.machineOf(projectId, nodeId);
            if (machine !== null) {
                return machine;
            }
        }
        return null;
    }

    /* The document as it stands, open or not, in its daemon-side form; a copy, so a caller may change it. */
    read(projectId: string): Promise<ProjectContent> {
        return this.locked(projectId, async () => structuredClone((await this.currentOf(projectId)).content));
    }

    /* The rev of the document, which a caller that decided on it names again with its write. */
    revision(projectId: string): Promise<number> {
        return this.locked(projectId, async () => (await this.currentOf(projectId)).rev);
    }

    /*
     * Applies a change to the document on disk, whether a client has the project open or not: an
     * agent keeps working after the person switched away, and `project.release` let go of the file
     * then. Throwing from `apply` writes nothing, and neither does a document that moved past
     * `expectedRev`, which is checked under the same lock the write takes.
     */
    mutate<T>(projectId: string, apply: MutationApply<T>, expectedRev?: number): Promise<T> {
        return this.locked(projectId, () => this.mutateUnlocked(projectId, apply, expectedRev));
    }

    /* The node fields the private file keeps one person's, which a view moved to another project takes along. */
    overlayFieldsOf(projectId: string): Promise<string[]> {
        return this.locked(projectId, async () => (await this.readCurrent(projectId, true)).overlayFields);
    }

    private async mutateUnlocked<T>(projectId: string, apply: MutationApply<T>, expectedRev?: number): Promise<T> {
        const current = await this.readCurrent(projectId);
        const { entry, path, rev, shared, overlayFields: held } = current;
        if (expectedRev !== undefined && expectedRev !== rev) {
            throw new ProjectError('rev-conflict', revisionConflictMessage('The project', expectedRev, rev));
        }
        /* A bound node keeps its machine through the change so `toPortable` leaves its folder alone,
           and a machine a verb names for any other node is dropped: only a person's save binds one. */
        const bound = this.remote.nodesOf(projectId);
        const content = withMachines(current.content, bound);
        const before = [...content.views];
        const mutation = await apply(content, { overlayFields: held });
        if (mutation.content === null) {
            return mutation.result;
        }
        this.refuseBoundViews(projectId, mutation.content);
        const binding = mutation.bindMachines ?? new Map<string, string>();
        const nowBound = { ...bound, ...Object.fromEntries(binding) };
        if (binding.size > 0) {
            this.refuseSharedRemoteNodes(projectId, mutation.content, shared, nowBound);
            // A write that fails leaves a binding for an id no document places; the next write prunes it.
            await this.remote.bind(projectId, binding, idsOf(mutation.content));
        }
        mutation.content = withBoundMachines(mutation.content, nowBound);
        const overlayFields = mutation.overlayFields === undefined ? held : [...mutation.overlayFields];
        const parsed = ProjectDocumentSchema.safeParse({ version: PROJECT_VERSION, rev: rev + 1, ...toPortable(mutation.content, entry.folder), shared });
        if (!parsed.success) {
            throw new ProjectError('project-invalid', `The change would not make a valid canvas: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
        }
        const document = parsed.data;
        const duplicate = duplicateIdIn(document.views);
        if (duplicate) {
            throw new ProjectError('project-invalid', `The change would give two things the id "${duplicate}"`);
        }
        await this.refuseTakenDesignFolders(entry.folder, { views: before, shared }, { views: document.views, shared });
        const state = this.open.get(projectId);
        const written = await this.writeFiles(path, toPortable(mutation.content, entry.folder), shared, document.rev, [], overlayFields);
        await this.followDesigns(projectId, entry.folder, { views: before, shared }, { views: document.views, shared });
        await this.remote.prune(projectId, idsOf(mutation.content));
        const renamed = identityChanged(entry, mutation.content);
        const nextEntry = renamed ? { ...entry, name: mutation.content.name, color: mutation.content.color, icon: mutation.content.icon ?? null } : entry;
        if (renamed) {
            await this.replaceEntry(nextEntry);
        }
        if (state) {
            state.entry = nextEntry;
            remember(state, written, document.rev, shared, document.views, overlayFields);
        }
        // Every sink, open or not: a client that released the project may still have it on screen in another workspace.
        await this.afterWrite(nextEntry, before, document, async () => {
            await mutation.landed?.();
            if (renamed) {
                this.publish(nextEntry);
            }
        });
        return mutation.result;
    }

    /*
     * What every write of this daemon ends with, a save and a verb alike. `announce` runs once the files
     * are settled and before `project.changed` goes out to every client but `origin`. The watcher reads
     * the write as our own and stays quiet, so a second client hears of it here or not at all. It runs
     * inside the lock, so a save this write makes stale finds the new document before its refusal.
     */
    private async afterWrite(
        entry: RegistryEntry,
        before: readonly ProjectView[],
        document: ProjectDocument,
        announce: (daemonSide: ProjectDocument) => Promise<void>,
        origin: string | null = null
    ): Promise<void> {
        const daemonSide = withoutMachines(this.fromDisk(entry.projectId, document, entry.folder));
        this.index.set(entry.projectId, entry.folder, daemonSide);
        await this.removeOrphanedFiles(entry, before, document.views);
        await announce(daemonSide);
        await this.announceChange(entry, daemonSide, origin);
    }

    /*
     * A view a write of this daemon dropped takes its file with it. An outside edit never does: a git
     * pull can drop a view whose file is still on its way, and that file is someone's work.
     */
    private async removeOrphanedFiles(entry: RegistryEntry, before: readonly ProjectView[], after: readonly ProjectView[]): Promise<void> {
        for (const files of this.links.viewFiles()) {
            const keep = viewIdsIn(after, files.noun);
            if ([...viewIdsIn(before, files.noun)].some((id) => !keep.has(id))) {
                await files.removeOrphans(entry.projectId, this.documentPath(entry), keep);
            }
        }
    }

    /*
     * Asks the clients that have this project on screen to show a view of it. Nothing is written:
     * what a person looks at is theirs, so this is an event a client may still ignore. False when
     * nobody was watching, which is what the verb reports back rather than failing over.
     */
    showView(projectId: string, viewId: string, by: string): boolean {
        let told = 0;
        for (const clientId of this.sinks.clientIds()) {
            if (this.holds.has(clientId, projectId)) {
                this.sinks.to(clientId, { event: 'project.showView', payload: { projectId, viewId, by } });
                told += 1;
            }
        }
        return told > 0;
    }

    /*
     * Where the project file sits and which views it holds, read from disk whether the project is open
     * or not: a diagram written after the person switched away still has to land in its own folder.
     */
    place(projectId: string): Promise<ProjectPlace> {
        return this.locked(projectId, () => this.placeUnlocked(projectId));
    }

    private async placeUnlocked(projectId: string): Promise<ProjectPlace> {
        const { path, content, shared } = await this.readCurrent(projectId);
        return { documentPath: path, views: content.views, shared };
    }

    /*
     * Runs work on a drawing or diagram file under the lock a save moves those files under, so the
     * side of the folder a view is on cannot change between finding its file and writing it. The
     * work gets `place` without the lock it already holds.
     */
    viewFileWork<T>(projectId: string, work: (place: () => Promise<ProjectPlace>) => Promise<T>): Promise<T> {
        return this.locked(projectId, () => work(() => this.placeUnlocked(projectId)));
    }

    /* An open project answers from memory, which its writes and its watcher keep current; without a watcher an outside edit would go unseen, so the disk answers. */
    private async currentOf(projectId: string, readOnly = false): Promise<CurrentDocument> {
        const state = this.open.get(projectId);
        if (state?.current) {
            return state.current;
        }
        const { rev, content, shared } = await this.readCurrent(projectId, readOnly);
        const current = { rev, content, shared };
        if (state && state.watcher !== null && this.open.get(projectId) === state) {
            state.current = current;
        }
        return current;
    }

    /* Deliberately not `readSharedFile`: a verb that finds a broken file refuses, it does not move a person's file aside. */
    private async readCurrent(
        projectId: string,
        readOnly = false
    ): Promise<{ entry: RegistryEntry; path: string; rev: number; content: ProjectContent; shared: string[]; overlayFields: string[] }> {
        const entry = await this.registry.entry(projectId);
        const path = this.documentPath(entry);
        await this.recover(entry);
        let text: string;
        try {
            text = await readFile(path, 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                throw new ProjectError('project-missing', `The project file of ${entry.name} is missing from ${path}`);
            }
            throw e;
        }
        const parsed = parseSharedOrRefuse(text);
        if (parsed.kind !== 'ok') {
            throw new ProjectError('project-invalid', `${path} does not parse as a canvas`);
        }
        const loaded = await this.loadFiles(path, entry, parsed.document, readOnly);
        return {
            entry,
            path,
            rev: loaded.rev,
            content: this.fromDisk(projectId, loaded.content, entry.folder),
            shared: loaded.shared,
            overlayFields: loaded.overlayFields
        };
    }

    async saveLocal(projectId: string, local: ProjectLocal): Promise<void> {
        await mkdir(join(this.home, 'projects'), { recursive: true, mode: 0o700 });
        await writeAtomic(this.localPath(projectId), JSON.stringify(local));
    }

    /* Writes or removes the icon file of the project's folder, and tells every client. */
    setIcon(payload: ProjectSetIconPayload): Promise<ProjectSummary> {
        return this.locked(payload.projectId, async () => {
            const entry = await this.registry.entry(payload.projectId);
            await this.summaries.setImage(entry.folder, payload.image);
            const summary = await this.summaries.summarize(entry);
            this.sinks.emit({ event: 'project.summary', payload: { summary } });
            return summary;
        });
    }

    setIdentity(payload: ProjectSetIdentityPayload): Promise<ProjectSummary> {
        return this.locked(payload.projectId, async () => {
            await this.mutateUnlocked(payload.projectId, (current) => {
                const name = payload.name ?? current.name;
                const icon = payload.icon === undefined ? (current.icon ?? null) : payload.icon;
                const color = payload.color ?? current.color;
                if (name === current.name && color === current.color && sameIcon(icon, current.icon ?? null)) {
                    return { content: null, result: null };
                }
                const next: ProjectContent = { ...current, name, color };
                if (icon === null) {
                    delete next.icon;
                } else {
                    next.icon = icon;
                }
                return { content: next, result: null };
            });
            return this.summaries.summarize(await this.registry.entry(payload.projectId));
        });
    }

    /* The file behind `GET /projects/<id>/icon`, or null when the project shows no image. */
    async iconFile(projectId: string, theme: 'light' | 'dark'): Promise<{ path: string; mime: string } | null> {
        return this.summaries.iconFile(
            (await this.registry.load()).find((candidate) => candidate.projectId === projectId),
            theme
        );
    }

    /*
     * Lets go of an open project without saying anything about it: the watcher stops and the
     * drawings and diagrams are dropped. This is what switching to another project does, which is why it leaves
     * the registry alone; a person closing a project is `closeProject`.
     */
    release(projectId: string): void {
        const state = this.open.get(projectId);
        if (!state) {
            return;
        }
        for (const files of this.links.viewFiles()) {
            files.closeProject(projectId);
        }
        this.links.databases.closeProject(projectId);
        this.links.templates.closeProject(projectId);
        state.watcher?.close();
        state.cancelSettle?.();
        this.open.delete(projectId);
    }

    /*
     * A person closed this project on one client. Another client that still has it open keeps it:
     * its sessions go on running and its place in the list does not move, so only this client's hold
     * goes. The last one out ends the sessions and drops the project under Recent.
     */
    async closeProject(projectId: string, clientId: string): Promise<ProjectCloseResult> {
        const otherClients = this.holds.others(clientId, projectId);
        this.holds.remove(clientId, projectId);
        if (otherClients > 0) {
            return { ended: 0, otherClients };
        }
        /* The sessions go before the write, the rule `view delete` follows: a shell that outlived
           the project it stood in would answer to a canvas nobody can open any more. */
        const sessions = this.index.sessionNodes(projectId);
        /* A client may open the project while its sessions end, and keeps what is left of it. An open
           replaces the loaded project before its client holds it, so that is checked as well. */
        const loaded = this.open.get(projectId);
        const reopened = (): boolean => this.holds.holders(projectId) > 0 || this.open.get(projectId) !== loaded;
        let ended = 0;
        if (this.links.closing && sessions.length > 0) {
            this.links.closing(
                (await this.registry.entry(projectId)).name,
                sessions.map((node) => node.id)
            );
        }
        for (const node of sessions) {
            if (reopened()) {
                break;
            }
            await this.links.endSession(node.kind, node.id);
            ended += 1;
        }
        const launches = reopened() ? 0 : await this.links.launches.end(projectId);
        if (!reopened()) {
            await this.links.language.end(projectId);
        }
        const kept = await this.locked(projectId, async () => {
            if (reopened()) {
                return true;
            }
            this.release(projectId);
            const closed = { ...(await this.registry.entry(projectId)), closedAt: Date.now() };
            await this.replaceEntry(closed);
            // Every client hears it: what a machine holds is the same for everyone on it, agents included.
            this.publish(closed);
            return false;
        });
        return { ended: ended + launches, otherClients: kept ? this.holds.holders(projectId) : 0 };
    }

    delete(projectId: string, removeFiles: boolean): Promise<void> {
        return this.locked(projectId, () => this.deleteUnlocked(projectId, removeFiles));
    }

    private async deleteUnlocked(projectId: string, removeFiles: boolean): Promise<void> {
        const entry = await this.registry.entry(projectId);
        this.release(projectId);
        this.index.remove(projectId);
        await this.registry.update((entries) => entries.filter((candidate) => candidate.projectId !== projectId));
        await rm(this.localPath(projectId), { force: true });
        await this.remote.forget(projectId);
        await this.peers.forgetProject(projectId);
        // Who wrote which lines of a project that is gone is of no use to anyone, and it lives in the daemon's own folder.
        await this.links.provenance
            .forget(projectId)
            .catch((e: unknown) => console.warn(`Forgetting the provenance of project ${projectId} failed:`, errorText(e)));
        await this.links.databases
            .forgetProject(projectId)
            .catch((e: unknown) => console.warn(`Forgetting the schema snapshots of project ${projectId} failed:`, errorText(e)));
        if (!removeFiles) {
            return;
        }
        // Only Ruimte's own files go; the rest of the folder is the person's project.
        const path = this.documentPath(entry);
        for (const dir of [drawingsDirOf(path), diagramsDirOf(path), privateDirOf(path)]) {
            await rm(dir, { recursive: true, force: true });
        }
        await rm(gitignorePathOf(path), { force: true });
        await rm(path, { force: true });
        // An icon or a file a person put in `.ruimte` keeps it, and `rmdir` says so by failing.
        await rmdir(dirname(path)).catch(() => undefined);
    }

    /*
     * Reads the document of every known project into the index, open or not. A file that is missing
     * or will not parse is skipped rather than set aside: nobody asked for it, and a daemon must
     * start whatever state a folder is in. A project a save or an open indexed meanwhile is newer
     * than what this read, so it is left alone.
     */
    async warmIndex(): Promise<void> {
        await this.hiddenAgents.load();
        const entries = await this.registry.load();
        await Promise.all(
            entries.map(async (entry) => {
                let text: string;
                try {
                    text = await readFile(this.documentPath(entry), 'utf8');
                } catch {
                    return;
                }
                const parsed = parseSharedFile(text);
                if (parsed.kind === 'ok' && !this.index.has(entry.projectId)) {
                    const loaded = await this.loadFiles(this.documentPath(entry), entry, parsed.document);
                    await this.indexRead(entry, documentOf(loaded.content, loaded.rev, loaded.shared));
                }
            })
        );
    }

    /* The daemon is going down: it lets go of every project without closing any of them. */
    closeAll(): void {
        for (const projectId of [...this.open.keys()]) {
            this.release(projectId);
        }
    }

    private locked<T>(projectId: string, work: () => Promise<T>): Promise<T> {
        return this.projectLocks.run(projectId, work);
    }

    private replaceEntry(next: RegistryEntry): Promise<void> {
        return this.registry.update((entries) => entries.map((entry) => (entry.projectId === next.projectId ? next : entry)));
    }

    /* Where the project file of an open project sits, which is where its drawings and diagrams sit beside it. */
    documentPathOf(projectId: string): string {
        return this.documentPath(this.require(projectId).entry);
    }

    /*
     * Whether a view lives in the shared file, which is what its drawing or diagram file follows.
     * A project nobody has open shares nothing as far as this answers: both callers only ask about
     * a project they already hold, and the safe reading of "I cannot tell" is that it stays private.
     */
    isSharedView(projectId: string, viewId: string): boolean {
        return this.open.get(projectId)?.shared.includes(viewId) === true;
    }

    openProjectIds(): string[] {
        return [...this.open.keys()];
    }

    isDrawingView(projectId: string, viewId: string): boolean {
        return this.require(projectId).drawingIds.has(viewId);
    }

    isDiagramView(projectId: string, viewId: string): boolean {
        return this.require(projectId).diagramIds.has(viewId);
    }

    private documentPath(entry: RegistryEntry): string {
        return documentPathInFolder(entry.folder);
    }

    private localPath(projectId: string): string {
        return join(this.home, 'projects', `${encodeURIComponent(projectId)}.local.json`);
    }

    private async readLocal(projectId: string): Promise<ProjectLocal> {
        try {
            return migrateLocal(JSON.parse(await readFile(this.localPath(projectId), 'utf8')));
        } catch {
            return EMPTY_LOCAL;
        }
    }

    private startWatching(state: OpenProject, path: string): void {
        try {
            // The directory, not the file: an atomic rename replaces the inode a file watcher would hold.
            state.watcher = this.seams.watch(dirname(path), { recursive: false }, (_event, filename) => {
                if (filename && filename !== PROJECT_FILE && !isIconFile(filename)) {
                    return;
                }
                // A platform that reports no name could have touched either file.
                state.iconTouched ||= !filename || isIconFile(filename);
                state.cancelSettle?.();
                state.cancelSettle = this.seams.schedule(() => {
                    state.cancelSettle = null;
                    // Under the lock, so a save or a verb never reads the rev between the file and the bump.
                    return this.locked(state.entry.projectId, () => this.reload(state, path)).catch((e: unknown) => {
                        console.warn(`An outside edit to ${path} could not be taken in:`, errorText(e));
                    });
                }, WATCH_SETTLE_MS);
            });
            state.watcher.on('error', () => undefined);
        } catch {
            // No watcher means no outside-edit detection; saving still works.
        }
    }

    private async reload(state: OpenProject, path: string): Promise<void> {
        if (this.open.get(state.entry.projectId) !== state) {
            return;
        }
        await this.recover(state.entry);
        if (state.iconTouched) {
            state.iconTouched = false;
            this.summaries.invalidate(state.entry.folder);
            this.publish(state.entry);
        }
        let text: string;
        try {
            text = await readFile(path, 'utf8');
        } catch {
            return;
        }
        if (text === state.lastText) {
            return;
        }
        const parsed = parseSharedFile(text);
        if (parsed.kind === 'invalid') {
            console.warn(`An outside edit to ${path} was ignored: ${parsed.message}`);
            return;
        }
        if (parsed.kind !== 'ok') {
            // Half-written by someone else; the event that follows the finished write reads it whole.
            return;
        }
        await this.takeOutsideEdit(state, path, text, parsed.document);
    }

    /*
     * A save goes over what this daemon last saw of the shared file, never over something a pull
     * put there since: the watcher only hears of that a moment later. What is found is taken in the
     * way the watcher would have, so the client that is refused has the new rev to save against.
     */
    private async refuseOverOutsideEdit(state: OpenProject): Promise<void> {
        const path = this.documentPath(state.entry);
        if (await this.recover(state.entry)) {
            throw new ProjectError('rev-conflict', `The interrupted save was recovered; the canvas is now at rev ${state.rev}`);
        }
        let text: string;
        try {
            text = await readFile(path, 'utf8');
        } catch (e) {
            // A file that is gone has nothing in it to lose, and the save puts it back.
            if (isNotFound(e)) {
                return;
            }
            throw e;
        }
        if (text === state.lastText) {
            return;
        }
        const parsed = parseSharedOrRefuse(text);
        if (parsed.kind === 'ok') {
            await this.takeOutsideEdit(state, path, text, parsed.document);
        }
        throw new ProjectError('rev-conflict', `The project file changed on disk; the canvas is now at rev ${state.rev}`);
    }

    /*
     * The rev goes up for this machine: what arrived is a state no client here has, and every one of
     * them has to base its next save on it. It goes into the private file too, since a verb reads the
     * rev from disk and would otherwise hand a different document out under the same number.
     */
    private async takeOutsideEdit(state: OpenProject, path: string, text: string, read: SharedFileRead): Promise<void> {
        const loaded = await this.loadFiles(path, state.entry, read);
        const rev = state.rev + 1;
        const privateFile = splitContent(loaded.content, loaded.shared, rev, loaded.overlayFields, await keptOverlayOf(path)).private;
        const privateText = serializePrivateFile(privateFile);
        if (privateText !== state.lastPrivate) {
            await writePrivateFile(privatePathOf(path), privateFile);
        }
        const document = documentOf(loaded.content, rev, loaded.shared);
        remember(state, { text, private: privateText }, rev, loaded.shared, document.views, loaded.overlayFields);
        state.entry = { ...state.entry, name: document.name, color: document.color, icon: document.icon ?? null };
        await this.announceChange(state.entry, await this.indexRead(state.entry, document));
        this.publish(state.entry);
    }

    private async recover(entry: RegistryEntry): Promise<boolean> {
        const path = this.documentPath(entry);
        const written = await recoverProjectWrite(path, this.writeIO).catch((e: unknown) => {
            throw asProjectError(e);
        });
        if (!written) {
            return false;
        }
        const parsed = parseSharedFile(written.text);
        if (parsed.kind !== 'ok') {
            throw new ProjectError('project-invalid', 'The recovered project file could not be read');
        }
        const loaded = await this.loadFiles(path, entry, parsed.document);
        const document = documentOf(loaded.content, loaded.rev, loaded.shared);
        const state = this.open.get(entry.projectId);
        if (state) {
            remember(state, written, loaded.rev, loaded.shared, document.views, loaded.overlayFields);
        }
        await this.announceChange(entry, await this.indexRead(entry, document));
        return true;
    }

    /*
     * Indexes a document read from disk, puts its design folders where it says they are, and drops the
     * bindings of nodes it no longer places; answers it in its daemon-side form.
     */
    private async indexRead(entry: RegistryEntry, document: ProjectDocument): Promise<ProjectDocument> {
        await this.settleDesigns(entry.projectId, entry.folder, { views: document.views, shared: document.shared ?? [] });
        const daemonSide = this.fromDisk(entry.projectId, document, entry.folder);
        this.index.set(entry.projectId, entry.folder, daemonSide);
        await this.remote.prune(entry.projectId, idsOf(document));
        return daemonSide;
    }

    /* Tells every client what a project looks like now; too small a change to ship a document for. */
    private publish(entry: RegistryEntry): void {
        void this.summaries
            .summarize(entry)
            .then((summary) => this.sinks.emit({ event: 'project.summary', payload: { summary } }))
            .catch((e: unknown) => console.warn(`Summing up project ${entry.projectId} failed:`, errorText(e)));
    }

    /*
     * The whole document goes only to the clients that hold the project. Every other client but `origin`
     * gets the summary with the rows of its sidebar, which is all a client without the project shows of it.
     */
    private async announceChange(entry: RegistryEntry, document: ProjectDocument, origin: string | null = null): Promise<void> {
        const { projectId } = entry;
        const bystanders: string[] = [];
        for (const clientId of this.sinks.clientIds()) {
            if (clientId === origin) {
                continue;
            }
            if (this.holds.has(clientId, projectId)) {
                this.sinks.to(clientId, { event: 'project.changed', payload: { projectId, document: this.onTheWire(projectId, document) } });
            } else {
                bystanders.push(clientId);
            }
        }
        if (bystanders.length === 0) {
            return;
        }
        const summary = await this.summaries.summarize(entry).catch(() => null);
        if (summary === null) {
            return;
        }
        const views = projectSidebarViews(document.views, document.shared ?? [], document.flags);
        for (const clientId of bystanders) {
            this.sinks.to(clientId, { event: 'project.summary', payload: { summary, views } });
        }
    }

    /* A view is shared whole, and a node of another machine reaches the shared file as a node of this one. */
    private refuseSharedRemoteNodes(
        projectId: string,
        content: ProjectContent,
        shared: readonly string[],
        binding: Readonly<Record<string, string>> = {}
    ): void {
        const bound = { ...this.remote.nodesOf(projectId), ...binding, ...Object.fromEntries(machinesOf(content)) };
        for (const view of content.views) {
            if (shared.includes(view.id) && isCanvasView(view) && view.hidden === true) {
                throw new ProjectError('hidden-view-shared', `${view.name} is kept for another machine and stays on this one`);
            }
            const held = isCanvasView(view) ? [view.id, ...view.nodes.map((node) => node.id)] : [view.id];
            if (shared.includes(view.id) && held.some((id) => Object.hasOwn(bound, id))) {
                throw new ProjectError('remote-node-shared', `${view.name} holds a node that runs on another machine, which stays on a canvas only you have`);
            }
        }
    }

    /*
     * A machine named for a node is taken only where it can hold: a terminal, a chat or a device that
     * has started nothing here, on another machine than this one. Anything else would leave work or a
     * history on this machine behind a node that no longer shows it.
     */
    private async refuseBadBindings(projectId: string, content: ProjectContent): Promise<void> {
        const bound = this.remote.nodesOf(projectId);
        for (const view of content.views) {
            if (!isCanvasView(view)) {
                continue;
            }
            for (const node of view.nodes) {
                if (node.machine === undefined) {
                    continue;
                }
                if (Object.hasOwn(bound, node.id)) {
                    if (bound[node.id] !== node.machine) {
                        throw new ProjectError('remote-node-invalid', `${node.id} runs on another machine already and stays there`);
                    }
                    continue;
                }
                if (node.kind !== 'terminal' && node.kind !== 'chat' && node.kind !== 'device') {
                    throw new ProjectError('remote-node-invalid', `A ${node.kind} node runs on this machine only`);
                }
                if (node.machine === this.links.bindings.machineId) {
                    throw new ProjectError('remote-node-invalid', `${node.id} cannot run on the machine it is on`);
                }
                if (await this.links.bindings.started(node.id)) {
                    throw new ProjectError('remote-node-invalid', `${node.id} has started work on this machine, which would stay behind`);
                }
            }
        }
    }

    /* A view of its own has no frame to carry a machine, so a node that runs elsewhere cannot become one; the node would start here. */
    private refuseBoundViews(projectId: string, content: ProjectContent): void {
        const bound = this.remote.nodesOf(projectId);
        const view = content.views.find((candidate) => Object.hasOwn(bound, candidate.id));
        if (view !== undefined) {
            throw new ProjectError('remote-node-view', `${view.id} runs on another machine and stays a node on a canvas`);
        }
    }

    /*
     * A document as the daemon holds it once read from disk: folders made absolute, and the canvases of
     * other machines hidden, which no file says.
     */
    private fromDisk<T extends ProjectContent>(projectId: string, content: T, folder: string | null): T {
        return withHiddenCanvases(fromPortable(content, folder), this.peers.canvasIdsOf(projectId));
    }

    /* A client reads the machine of a node off the document; the daemon keeps it apart from what it indexes. */
    private onTheWire<T extends ProjectContent>(projectId: string, content: T): T {
        return withMachines(content, this.remote.nodesOf(projectId));
    }

    private require(projectId: string): OpenProject {
        const state = this.open.get(projectId);
        if (!state) {
            throw new ProjectError('project-not-found', `Project ${projectId} is not open`);
        }
        return state;
    }
}

/* The shared file as read, refused when it breaks a rule of the project or comes from a newer Ruimte. */
function parseSharedOrRefuse(text: string): ReturnType<typeof parseSharedFile> {
    const parsed = parseSharedFile(text);
    if (parsed.kind === 'invalid') {
        throw new ProjectError('project-invalid', parsed.message);
    }
    if (parsed.kind === 'too-new') {
        throw new ProjectError('project-too-new', tooNewMessage('project', parsed.version, PROJECT_VERSION));
    }
    return parsed;
}
