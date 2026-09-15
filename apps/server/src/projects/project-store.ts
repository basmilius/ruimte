import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
    EMPTY_LOCAL,
    MAIN_VIEW_ID,
    MAIN_VIEW_NAME,
    ProjectDocumentSchema,
    ProjectIconChoiceSchema,
    UNKNOWN_KIND,
    duplicateIdIn,
    migrateLocal,
    type ProjectContent,
    type ProjectDocument,
    type ProjectIcon,
    type ProjectLocal,
    type ProjectNameSource,
    type ProjectOpenPayload,
    type ProjectOpenResult,
    type ProjectSetIconPayload,
    type ProjectSummary,
    type ProjectView
} from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { SYSTEM_WATCH, type DirectoryWatcher, type WatchSeams } from '../fs/watch-seam.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import {
    diagramsDirOf,
    documentPathInFolder,
    drawingsDirOf,
    fromPortable,
    parseDocument,
    readDocument,
    removeIconFiles,
    toPortable,
    writeDocument,
    writeIconFile,
    ICON_EXTENSION_BY_MIME,
    PROJECT_FILE
} from './project-files.ts';
import { ProjectIndex } from './project-index.ts';
import { IdentityCache, readIdeaName, sniffMime, ICON_MAX_BYTES, type DerivedIcon } from './project-identity.ts';
import { errorText } from '../error-text.ts';

type ProjectErrorCode = 'project-not-found' | 'project-missing' | 'project-invalid' | 'rev-conflict' | 'folder-not-found' | 'folder-create-failed' | 'bad-icon';

export class ProjectError extends Error {
    readonly code: ProjectErrorCode;

    constructor(code: ProjectErrorCode, message: string) {
        super(message);
        this.name = 'ProjectError';
        this.code = code;
    }
}

const RegistryEntrySchema = z.object({
    projectId: z.string().min(1),
    name: z.string(),
    color: z.string(),
    folder: z.string().nullable(),
    lastOpenedAt: z.number(),
    /* When a person last closed this project. Set means the menu keeps it under Recent; only
       closing puts it there and only opening takes it out, so neither age nor whether it is open
       right now moves a project. Absent in a registry written before closing meant anything. */
    closedAt: z.number().nullish(),
    // A cache of what the canvas file holds, so `project.list` needs no document read.
    icon: ProjectIconChoiceSchema.nullish()
});
type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

const RegistrySchema = z.object({ projects: z.array(RegistryEntrySchema) });

// Editors and git write in bursts; one event per burst is what the client wants.
const WATCH_SETTLE_MS = 150;

// The only file in `.ruimte` besides the canvas that the daemon has a use for.
const isIconFile = (filename: string): boolean => filename.startsWith('icon.');

const DEFAULT_COLOR = '#7c74ff';

/* What a project starts with: one canvas, under the id every migrated version-1 file gets too. */
const firstView = (): ProjectView => ({ kind: 'canvas', id: MAIN_VIEW_ID, name: MAIN_VIEW_NAME, nodes: [], texts: [], edges: [], layouts: [] });

const newId = (): string => randomBytes(6).toString('base64url');

/*
 * What a store of view files (the drawings, the diagrams) needs to hear from this one. It is an
 * interface rather than the class so the files do not import each other; the daemon hands the real
 * stores over on startup.
 */
export interface ProjectViewFiles {
    /* Every file whose view left the project is deleted, but only when a person saved. */
    removeOrphans(projectId: string, keep: Set<string>): Promise<void>;
    closeProject(projectId: string): void;
}

/* What a change hands back: the whole new content, and whatever the caller wants to answer with. */
export interface ProjectMutation<T> {
    /* Null when nothing changed, which is what a dry run leaves behind: it runs every check under
       the same lock a write takes, so what it answers is what the write would have done. */
    content: ProjectContent | null;
    result: T;
    /* Runs once the document is on disk and before `project.changed` goes out, so what a new node
       needs beside the file exists before a client mounts it, and never for a change that was refused. */
    landed?: () => Promise<void>;
}

interface OpenProject {
    entry: RegistryEntry;
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
    watcher: DirectoryWatcher | null;
    cancelSettle: (() => void) | null;
    // The burst that is settling touched an icon file, so the folder has to be read again.
    iconTouched: boolean;
    // The drawing and diagram views of the document as it stands, so an orphan file can be told from a live one.
    drawingIds: Set<string>;
    diagramIds: Set<string>;
}

/* A view of a kind this daemon does not know may own a file under either folder, so it counts as live for both. */
const viewIdsIn = (views: ProjectView[], kind: 'drawing' | 'diagram'): Set<string> =>
    new Set(views.filter((view) => view.kind === kind || view.kind === UNKNOWN_KIND).map((view) => view.id));

const drawingIdsIn = (views: ProjectView[]): Set<string> => viewIdsIn(views, 'drawing');

const diagramIdsIn = (views: ProjectView[]): Set<string> => viewIdsIn(views, 'diagram');

/*
 * Every canvas the daemon knows, where it lives and which ones are open. A folder project is
 * `<folder>/.ruimte/project.json`; one without a folder lives under the app data dir. Machine
 * state (camera, focus) never goes into the shared file.
 */
export class ProjectStore {
    readonly home: string;
    /* Every known project's last document, which outlives `release`: the sessions of a project keep running after a client lets go of it. */
    readonly index = new ProjectIndex();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly open = new Map<string, OpenProject>();
    /* Which client has which project on screen. `project.changed` goes to every socket, since a
       client that let go of a project may still hold its document, but showing a view is aimed at a
       person: a client without the project in a workspace has nothing to do with it and is not told. */
    private readonly viewers = new Map<string, Set<string>>();
    private registry: RegistryEntry[] | null = null;
    private readonly identity = new IdentityCache();
    private drawings: ProjectViewFiles | null = null;
    private diagrams: ProjectViewFiles | null = null;
    // Registry changes run one after the other; two clients opening at once must not lose an entry.
    private chain: Promise<unknown> = Promise.resolve();

    private readonly seams: WatchSeams;

    constructor(home: string, seams: WatchSeams = SYSTEM_WATCH) {
        this.home = home;
        this.seams = seams;
    }

    /* The drawing store follows this one: it hears about a save and about a project closing. */
    attachDrawings(drawings: ProjectViewFiles): void {
        this.drawings = drawings;
    }

    /* The diagram store follows this one the same way. */
    attachDiagrams(diagrams: ProjectViewFiles): void {
        this.diagrams = diagrams;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
                this.viewers.delete(clientId);
            }
        };
    }

    /* This client put the project on screen, which is what makes it one `showView` reaches. */
    addViewer(clientId: string, projectId: string): void {
        const held = this.viewers.get(clientId);
        if (held) {
            held.add(projectId);
            return;
        }
        this.viewers.set(clientId, new Set([projectId]));
    }

    /* This client let the project go; its sessions keep running, but it is not watching any more. */
    removeViewer(clientId: string, projectId: string): void {
        this.viewers.get(clientId)?.delete(projectId);
    }

    /* Every project in the registry, without opening or resolving anything: what a folder is called
       and which project it is, for whoever has a path in hand and wants the name that goes with it. */
    async known(): Promise<{ projectId: string; name: string; folder: string }[]> {
        return (await this.loadRegistry()).flatMap((entry) =>
            entry.folder === null ? [] : [{ projectId: entry.projectId, name: entry.name, folder: entry.folder }]
        );
    }

    /* Reading the list makes nothing: a daemon nobody has opened a project on answers an empty list,
       and a client that has just paired with one is not handed a project it never asked for. */
    async list(): Promise<ProjectSummary[]> {
        const entries = await this.loadRegistry();
        return Promise.all(entries.map((entry) => this.summarize(entry)));
    }

    /*
     * What the client shows for one project: the name and color from its canvas file, plus the
     * icon and where the name came from. A chosen icon wins; without one the folder is asked.
     */
    private async summarize(entry: RegistryEntry): Promise<ProjectSummary> {
        const available = entry.folder === null || (await exists(this.documentPath(entry)));
        const derived = entry.folder ? await this.identity.resolve(entry.folder) : null;
        const image = derived?.icon ?? null;
        const icon: ProjectIcon = entry.icon ?? (image ? imageIcon(image) : initialIcon(entry.name));
        return {
            projectId: entry.projectId,
            name: entry.name,
            color: entry.color,
            folder: entry.folder,
            lastOpenedAt: entry.lastOpenedAt,
            closedAt: entry.closedAt ?? null,
            available,
            icon,
            nameSource: nameSourceOf(entry.name, entry.folder)
        };
    }

    openProject(payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        return this.locked(() => this.openUnlocked(payload));
    }

    private async openUnlocked(payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        const entries = await this.loadRegistry();
        let entry: RegistryEntry | undefined;
        // Only a folder the daemon never saw before may take its name from `.idea/.name`.
        let firstOpen = false;
        if (payload.projectId) {
            entry = entries.find((candidate) => candidate.projectId === payload.projectId);
            if (!entry) {
                throw new ProjectError('project-not-found', `No project ${payload.projectId}`);
            }
        } else if (payload.folder) {
            const folder = resolve(payload.folder);
            /* Nothing is ever created over something that is already there: a file in the way falls
               through to the check below, which says so in the sentence written for it. */
            if (payload.createFolder && !(await exists(folder))) {
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
                color: payload.color ?? DEFAULT_COLOR,
                folder,
                lastOpenedAt: Date.now()
            };
        } else {
            entry = {
                projectId: newId(),
                name: payload.name ?? 'Untitled project',
                color: payload.color ?? DEFAULT_COLOR,
                folder: null,
                lastOpenedAt: Date.now()
            };
        }

        const path = this.documentPath(entry);
        let outcome = await readDocument(path);
        if (outcome.kind === 'invalid') {
            throw new ProjectError('project-invalid', outcome.message);
        }
        if (outcome.kind === 'corrupt') {
            console.warn(`Set aside a canvas that would not parse: ${outcome.setAside}`);
            outcome = { kind: 'missing' };
        }
        let document: ProjectDocument;
        let text: string;
        if (outcome.kind === 'ok') {
            document = outcome.document;
            text = outcome.text;
        } else if (payload.projectId && entry.folder) {
            throw new ProjectError('project-missing', `The project file of ${entry.name} is missing from ${entry.folder}`);
        } else {
            // The one moment `.idea/.name` counts: it seeds the file, and the file owns the name from here.
            if (firstOpen && entry.folder && !payload.name) {
                entry = { ...entry, name: (await readIdeaName(entry.folder)) ?? entry.name };
            }
            document = { version: 2, rev: 0, name: entry.name, color: entry.color, views: [firstView()] };
            text = await writeDocument(path, document);
        }

        // Opening is what takes a project back out of Recent, wherever the open came from.
        const wasRecent = entry.closedAt !== null && entry.closedAt !== undefined;
        entry = { ...entry, name: document.name, color: document.color, icon: document.icon ?? null, lastOpenedAt: Date.now(), closedAt: null };
        await this.saveRegistry([...entries.filter((candidate) => candidate.projectId !== entry!.projectId), entry]);
        if (wasRecent) {
            this.publish(entry);
        }

        this.release(entry.projectId);
        this.index.set(entry.projectId, entry.folder, fromPortable(document, entry.folder));
        const state: OpenProject = {
            entry,
            rev: document.rev,
            lastText: text,
            watcher: null,
            cancelSettle: null,
            iconTouched: false,
            drawingIds: drawingIdsIn(document.views),
            diagramIds: diagramIdsIn(document.views)
        };
        this.open.set(entry.projectId, state);
        this.startWatching(state, path);

        // Opening a project is the moment to look at the folder again, whatever the cache holds.
        if (entry.folder) {
            this.identity.invalidate(entry.folder);
        }
        return {
            summary: await this.summarize(entry),
            document: fromPortable(document, entry.folder),
            local: await this.readLocal(entry.projectId)
        };
    }

    /* `origin` is the client that sent the save: it already holds the document, and every other client is told. */
    save(projectId: string, baseRev: number, content: ProjectContent, origin: string | null = null): Promise<number> {
        return this.locked(() => this.saveUnlocked(projectId, baseRev, content, origin));
    }

    private async saveUnlocked(projectId: string, baseRev: number, content: ProjectContent, origin: string | null): Promise<number> {
        const state = this.require(projectId);
        if (baseRev !== state.rev) {
            throw new ProjectError('rev-conflict', `The canvas is at rev ${state.rev}, the save was based on ${baseRev}`);
        }
        const document: ProjectDocument = { version: 2, rev: state.rev + 1, ...toPortable(content, state.entry.folder) };
        state.lastText = await writeDocument(this.documentPath(state.entry), document);
        state.rev = document.rev;
        this.index.set(projectId, state.entry.folder, fromPortable(document, state.entry.folder));
        const drawingIds = drawingIdsIn(document.views);
        // A view that a person deleted here takes its file with it. An outside edit never does:
        // a git pull can drop a view whose file is still on its way, and that file is someone's work.
        if (this.drawings && [...state.drawingIds].some((id) => !drawingIds.has(id))) {
            await this.drawings.removeOrphans(projectId, drawingIds);
        }
        state.drawingIds = drawingIds;
        const diagramIds = diagramIdsIn(document.views);
        if (this.diagrams && [...state.diagramIds].some((id) => !diagramIds.has(id))) {
            await this.diagrams.removeOrphans(projectId, diagramIds);
        }
        state.diagramIds = diagramIds;
        const icon = content.icon ?? null;
        if (content.name !== state.entry.name || content.color !== state.entry.color || !sameIcon(icon, state.entry.icon ?? null)) {
            state.entry = { ...state.entry, name: content.name, color: content.color, icon };
            const entries = await this.loadRegistry();
            await this.saveRegistry(entries.map((entry) => (entry.projectId === projectId ? state.entry : entry)));
            this.publish(state.entry);
        }
        /* The watcher reads this write as our own and stays quiet, so a second client with the project
           on screen hears about it here or not at all. Not the sender: its screen is already ahead of
           this document, and taking it in would undo a drag that went on while the save was out. Inside
           the lock, so a save of another client that this one makes stale finds the document there
           before its refusal. */
        const daemonSide = fromPortable(document, state.entry.folder);
        this.emit({ event: 'project.changed', payload: { projectId, document: daemonSide } }, origin);
        return document.rev;
    }

    /* The document as it stands on disk, open or not, in its daemon-side form. */
    read(projectId: string): Promise<ProjectContent> {
        return this.locked(async () => (await this.readCurrent(projectId)).content);
    }

    /*
     * Applies a change to the document on disk, whether a client has the project open or not: an
     * agent keeps working after the person switched away, and `project.release` let go of the file
     * then. Throwing from `apply` writes nothing.
     */
    mutate<T>(projectId: string, apply: (content: ProjectContent) => ProjectMutation<T> | Promise<ProjectMutation<T>>): Promise<T> {
        return this.locked(async () => {
            const { entry, path, rev, content } = await this.readCurrent(projectId);
            const mutation = await apply(content);
            if (mutation.content === null) {
                return mutation.result;
            }
            const parsed = ProjectDocumentSchema.safeParse({ version: 2, rev: rev + 1, ...toPortable(mutation.content, entry.folder) });
            if (!parsed.success) {
                throw new ProjectError('project-invalid', `The change would not make a valid canvas: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
            }
            const document = parsed.data;
            const duplicate = duplicateIdIn(document.views);
            if (duplicate) {
                throw new ProjectError('project-invalid', `The change would give two things the id "${duplicate}"`);
            }
            const text = await writeDocument(path, document);
            const state = this.open.get(projectId);
            if (state) {
                state.lastText = text;
                state.rev = document.rev;
                state.drawingIds = drawingIdsIn(document.views);
                state.diagramIds = diagramIdsIn(document.views);
            }
            const daemonSide = fromPortable(document, entry.folder);
            this.index.set(projectId, entry.folder, daemonSide);
            await mutation.landed?.();
            // Every sink, open or not: a client that released the project may still have it on screen in another workspace.
            this.emit({ event: 'project.changed', payload: { projectId, document: daemonSide } });
            return mutation.result;
        });
    }

    /*
     * Asks the clients that have this project on screen to show a view of it. Nothing is written:
     * what a person looks at is theirs, so this is an event a client may still ignore. False when
     * nobody was watching, which is what the verb reports back rather than failing over.
     */
    showView(projectId: string, viewId: string, by: string): boolean {
        let told = 0;
        for (const [clientId, sink] of this.sinks) {
            if (this.viewers.get(clientId)?.has(projectId) === true) {
                sink({ event: 'project.showView', payload: { projectId, viewId, by } });
                told += 1;
            }
        }
        return told > 0;
    }

    /*
     * Where the project file sits and which views it holds, read from disk whether the project is open
     * or not: a diagram written after the person switched away still has to land in its own folder.
     */
    place(projectId: string): Promise<{ documentPath: string; views: ProjectView[] }> {
        return this.locked(async () => {
            const { path, content } = await this.readCurrent(projectId);
            return { documentPath: path, views: content.views };
        });
    }

    /* Deliberately not `readDocument`: a verb that finds a broken file refuses, it does not move a person's file aside. */
    private async readCurrent(projectId: string): Promise<{ entry: RegistryEntry; path: string; rev: number; content: ProjectContent }> {
        const entry = (await this.loadRegistry()).find((candidate) => candidate.projectId === projectId);
        if (!entry) {
            throw new ProjectError('project-not-found', `No project ${projectId}`);
        }
        const path = this.documentPath(entry);
        let text: string;
        try {
            text = await readFile(path, 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                throw new ProjectError('project-missing', `The project file of ${entry.name} is missing from ${path}`);
            }
            throw e;
        }
        const parsed = parseDocument(text);
        if (parsed.kind === 'invalid') {
            throw new ProjectError('project-invalid', parsed.message);
        }
        if (parsed.kind !== 'ok') {
            throw new ProjectError('project-invalid', `${path} does not parse as a canvas`);
        }
        const { version: _version, rev, ...content } = parsed.document;
        return { entry, path, rev, content: fromPortable(content, entry.folder) };
    }

    async saveLocal(projectId: string, local: ProjectLocal): Promise<void> {
        await mkdir(join(this.home, 'projects'), { recursive: true, mode: 0o700 });
        await writeAtomic(this.localPath(projectId), JSON.stringify(local));
    }

    /*
     * Writes or removes `<folder>/.ruimte/icon.<ext>`. The bytes are checked against their own
     * magic, never the MIME the client claims, so a file that is not an image never lands there.
     */
    setIcon(payload: ProjectSetIconPayload): Promise<ProjectSummary> {
        return this.locked(() => this.setIconUnlocked(payload));
    }

    private async setIconUnlocked(payload: ProjectSetIconPayload): Promise<ProjectSummary> {
        const entries = await this.loadRegistry();
        const entry = entries.find((candidate) => candidate.projectId === payload.projectId);
        if (!entry) {
            throw new ProjectError('project-not-found', `No project ${payload.projectId}`);
        }
        if (!entry.folder) {
            throw new ProjectError('bad-icon', 'A canvas without a folder has nowhere to keep an icon');
        }
        if (payload.image === null) {
            await removeIconFiles(entry.folder);
        } else {
            const bytes = decodeImage(payload.image.base64);
            const mime = sniffMime(bytes);
            const extension = mime ? ICON_EXTENSION_BY_MIME[mime] : undefined;
            if (!extension) {
                throw new ProjectError('bad-icon', 'That file is not a PNG, JPEG, GIF, WebP or SVG image');
            }
            await writeIconFile(entry.folder, extension, bytes);
        }
        this.identity.invalidate(entry.folder);
        const summary = await this.summarize(entry);
        this.emit({ event: 'project.summary', payload: { summary } });
        return summary;
    }

    /* The file behind `GET /projects/<id>/icon`, or null when the project shows no image. */
    async iconFile(projectId: string, theme: 'light' | 'dark'): Promise<{ path: string; mime: string } | null> {
        const entry = (await this.loadRegistry()).find((candidate) => candidate.projectId === projectId);
        if (!entry?.folder || entry.icon) {
            return null;
        }
        const icon = (await this.identity.resolve(entry.folder)).icon;
        if (!icon) {
            return null;
        }
        if (theme === 'dark' && icon.darkPath && icon.darkMime) {
            return { path: icon.darkPath, mime: icon.darkMime };
        }
        return { path: icon.lightPath, mime: icon.mime };
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
        this.drawings?.closeProject(projectId);
        this.diagrams?.closeProject(projectId);
        state.watcher?.close();
        state.cancelSettle?.();
        this.open.delete(projectId);
    }

    /* A person closed this project: it lets go and drops under Recent until someone opens it again. */
    closeProject(projectId: string): Promise<void> {
        return this.locked(async () => {
            this.release(projectId);
            const entries = await this.loadRegistry();
            const entry = entries.find((candidate) => candidate.projectId === projectId);
            if (!entry) {
                throw new ProjectError('project-not-found', `No project ${projectId}`);
            }
            const closed = { ...entry, closedAt: Date.now() };
            await this.saveRegistry(entries.map((candidate) => (candidate.projectId === projectId ? closed : candidate)));
            // Every client shows the same list, so the row moves on the other machines too.
            this.publish(closed);
        });
    }

    delete(projectId: string, removeFiles: boolean): Promise<void> {
        return this.locked(() => this.deleteUnlocked(projectId, removeFiles));
    }

    private async deleteUnlocked(projectId: string, removeFiles: boolean): Promise<void> {
        const entries = await this.loadRegistry();
        const entry = entries.find((candidate) => candidate.projectId === projectId);
        if (!entry) {
            throw new ProjectError('project-not-found', `No project ${projectId}`);
        }
        this.release(projectId);
        this.index.remove(projectId);
        await this.saveRegistry(entries.filter((candidate) => candidate.projectId !== projectId));
        await rm(this.localPath(projectId), { force: true });
        if (!removeFiles) {
            return;
        }
        if (entry.folder) {
            // Only the canvas file and the drawings and diagrams that belong to it; the rest of the folder
            // is the person's project. Those go first, or the rmdir below finds `.ruimte` full.
            await rm(drawingsDirOf(this.documentPath(entry)), { recursive: true, force: true });
            await rm(diagramsDirOf(this.documentPath(entry)), { recursive: true, force: true });
            await rm(this.documentPath(entry), { force: true });
            // `.ruimte` goes only when nothing else is in it: an icon or a file a person put there
            // keeps it, and `rmdir` says so by failing.
            await rmdir(dirname(this.documentPath(entry))).catch(() => undefined);
        } else {
            await rm(dirname(this.documentPath(entry)), { recursive: true, force: true });
        }
    }

    /*
     * Reads the document of every known project into the index, open or not. A file that is missing
     * or will not parse is skipped rather than set aside: nobody asked for it, and a daemon must
     * start whatever state a folder is in. A project a save or an open indexed meanwhile is newer
     * than what this read, so it is left alone.
     */
    async warmIndex(): Promise<void> {
        const entries = await this.loadRegistry();
        await Promise.all(
            entries.map(async (entry) => {
                let text: string;
                try {
                    text = await readFile(this.documentPath(entry), 'utf8');
                } catch {
                    return;
                }
                const parsed = parseDocument(text);
                if (parsed.kind === 'ok' && !this.index.has(entry.projectId)) {
                    this.index.set(entry.projectId, entry.folder, fromPortable(parsed.document, entry.folder));
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

    private locked<T>(work: () => Promise<T>): Promise<T> {
        const run = this.chain.then(work, work);
        this.chain = run.catch(() => undefined);
        return run;
    }

    /* Where the project file of an open project sits, which is where its drawings and diagrams sit beside it. */
    documentPathOf(projectId: string): string {
        return this.documentPath(this.require(projectId).entry);
    }

    /* The projects that are open right now, in no particular order. */
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
        return entry.folder ? documentPathInFolder(entry.folder) : join(this.home, 'projects', encodeURIComponent(entry.projectId), PROJECT_FILE);
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
                    return this.reload(state, path);
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
        if (state.iconTouched) {
            state.iconTouched = false;
            if (state.entry.folder) {
                this.identity.invalidate(state.entry.folder);
                this.publish(state.entry);
            }
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
        const parsed = parseDocument(text);
        if (parsed.kind === 'invalid') {
            console.warn(`An outside edit to ${path} was ignored: ${parsed.message}`);
            return;
        }
        if (parsed.kind !== 'ok') {
            // Half-written by someone else; the event that follows the finished write reads it whole.
            return;
        }
        const { document } = parsed;
        state.lastText = text;
        state.rev = document.rev;
        state.drawingIds = drawingIdsIn(document.views);
        state.diagramIds = diagramIdsIn(document.views);
        state.entry = { ...state.entry, name: document.name, color: document.color, icon: document.icon ?? null };
        this.index.set(state.entry.projectId, state.entry.folder, fromPortable(document, state.entry.folder));
        this.emit({ event: 'project.changed', payload: { projectId: state.entry.projectId, document: fromPortable(document, state.entry.folder) } });
        this.publish(state.entry);
    }

    /* Tells every client what a project looks like now; too small a change to ship a document for. */
    private publish(entry: RegistryEntry): void {
        void this.summarize(entry)
            .then((summary) => this.emit({ event: 'project.summary', payload: { summary } }))
            .catch(() => undefined);
    }

    private emit(event: SessionEvent, except: string | null = null): void {
        for (const [clientId, sink] of this.sinks) {
            if (clientId !== except) {
                sink(event);
            }
        }
    }

    private require(projectId: string): OpenProject {
        const state = this.open.get(projectId);
        if (!state) {
            throw new ProjectError('project-not-found', `Project ${projectId} is not open`);
        }
        return state;
    }

    private async loadRegistry(): Promise<RegistryEntry[]> {
        if (this.registry) {
            return this.registry;
        }
        try {
            const parsed = RegistrySchema.safeParse(JSON.parse(await readFile(join(this.home, 'projects.json'), 'utf8')));
            this.registry = parsed.success ? parsed.data.projects : [];
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The project registry would not parse; starting with an empty one:', errorText(e));
            }
            this.registry = [];
        }
        return this.registry;
    }

    private async saveRegistry(entries: RegistryEntry[]): Promise<void> {
        this.registry = entries;
        await mkdir(this.home, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.home, 'projects.json'), `${JSON.stringify({ projects: entries }, null, 2)}\n`);
    }
}

const imageIcon = (icon: DerivedIcon): ProjectIcon => ({ kind: 'image', value: icon.from, version: icon.version });

const initialIcon = (name: string): ProjectIcon => ({ kind: 'initial', value: [...name.trim()][0]?.toUpperCase() ?? '?' });

const sameIcon = (left: ProjectIcon | null, right: ProjectIcon | null): boolean =>
    left === right || (left !== null && right !== null && left.kind === right.kind && left.value === right.value);

/*
 * A name that still matches the folder's own is the folder's, not a decision; the client says so
 * under the icon picker. Renaming to exactly that string reads as the folder's too, which is the
 * honest answer: there is nothing on disk that says otherwise.
 */
const nameSourceOf = (name: string, folder: string | null): ProjectNameSource => {
    if (!folder) {
        return 'chosen';
    }
    return name === basename(folder) ? 'folder' : 'chosen';
};

const decodeImage = (base64: string): Uint8Array => {
    // Base64 carries three bytes per four characters; the cap is checked before decoding a blob.
    if (Math.ceil(base64.length / 4) * 3 > ICON_MAX_BYTES) {
        throw new ProjectError('bad-icon', 'That image is larger than 256 KB');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) {
        throw new ProjectError('bad-icon', 'That image is empty or larger than 256 KB');
    }
    return bytes;
};

const exists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
};

const isDirectory = async (path: string): Promise<boolean> => {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
};
