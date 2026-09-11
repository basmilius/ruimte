import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
    EMPTY_LOCAL,
    MAIN_VIEW_ID,
    MAIN_VIEW_NAME,
    ProjectIconChoiceSchema,
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
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import {
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
import { IdentityCache, readIdeaName, sniffMime, ICON_MAX_BYTES, type DerivedIcon } from './project-identity.ts';

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
 * What the drawing store needs to hear from this one. It is an interface rather than the class so
 * the two files do not import each other; the daemon hands the real store over on startup.
 */
export interface ProjectDrawings {
    /* Every drawing file whose view left the project is deleted, but only when a person saved. */
    removeOrphans(projectId: string, keep: Set<string>): Promise<void>;
    closeProject(projectId: string): void;
}

interface OpenProject {
    entry: RegistryEntry;
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
    watcher: FSWatcher | null;
    settle: ReturnType<typeof setTimeout> | null;
    // The burst that is settling touched an icon file, so the folder has to be read again.
    iconTouched: boolean;
    // The drawing views of the document as it stands, so an orphan file can be told from a live one.
    drawingIds: Set<string>;
}

const drawingIdsIn = (views: ProjectView[]): Set<string> => new Set(views.filter((view) => view.kind === 'drawing').map((view) => view.id));

/*
 * Every canvas the daemon knows, where it lives and which ones are open. A folder project is
 * `<folder>/.ruimte/project.json`; one without a folder lives under the app data dir. Machine
 * state (camera, focus) never goes into the shared file.
 */
export class ProjectStore {
    readonly home: string;
    private readonly sinks = new Map<string, SessionSink>();
    private readonly open = new Map<string, OpenProject>();
    private registry: RegistryEntry[] | null = null;
    private readonly identity = new IdentityCache();
    private drawings: ProjectDrawings | null = null;
    // Registry changes run one after the other; two clients opening at once must not lose an entry.
    private chain: Promise<unknown> = Promise.resolve();

    constructor(home: string) {
        this.home = home;
    }

    /* The drawing store follows this one: it hears about a save and about a project closing. */
    attachDrawings(drawings: ProjectDrawings): void {
        this.drawings = drawings;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    /* Every project in the registry, without opening or resolving anything: what a folder is called
       and which project it is, for whoever has a path in hand and wants the name that goes with it. */
    async known(): Promise<{ projectId: string; name: string; folder: string }[]> {
        return (await this.loadRegistry()).flatMap((entry) =>
            entry.folder === null ? [] : [{ projectId: entry.projectId, name: entry.name, folder: entry.folder }]
        );
    }

    async list(): Promise<ProjectSummary[]> {
        await this.locked(async () => {
            // A daemon that knows no canvas makes one, so every client boots into the same project.
            if ((await this.loadRegistry()).length === 0) {
                await this.openUnlocked({ name: 'Untitled project' });
            }
        });
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
            throw new ProjectError('project-missing', `The canvas of ${entry.name} is gone from ${entry.folder}`);
        } else {
            // The one moment `.idea/.name` counts: it seeds the file, and the file owns the name from here.
            if (firstOpen && entry.folder && !payload.name) {
                entry = { ...entry, name: (await readIdeaName(entry.folder)) ?? entry.name };
            }
            document = { version: 2, rev: 0, name: entry.name, color: entry.color, views: [firstView()] };
            text = await writeDocument(path, document);
        }

        entry = { ...entry, name: document.name, color: document.color, icon: document.icon ?? null, lastOpenedAt: Date.now() };
        await this.saveRegistry([...entries.filter((candidate) => candidate.projectId !== entry!.projectId), entry]);

        this.close(entry.projectId);
        const state: OpenProject = {
            entry,
            rev: document.rev,
            lastText: text,
            watcher: null,
            settle: null,
            iconTouched: false,
            drawingIds: drawingIdsIn(document.views)
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

    save(projectId: string, baseRev: number, content: ProjectContent): Promise<number> {
        return this.locked(() => this.saveUnlocked(projectId, baseRev, content));
    }

    private async saveUnlocked(projectId: string, baseRev: number, content: ProjectContent): Promise<number> {
        const state = this.require(projectId);
        if (baseRev !== state.rev) {
            throw new ProjectError('rev-conflict', `The canvas is at rev ${state.rev}, the save was based on ${baseRev}`);
        }
        const document: ProjectDocument = { version: 2, rev: state.rev + 1, ...toPortable(content, state.entry.folder) };
        state.lastText = await writeDocument(this.documentPath(state.entry), document);
        state.rev = document.rev;
        const drawingIds = drawingIdsIn(document.views);
        // A view that a person deleted here takes its file with it. An outside edit never does:
        // a git pull can drop a view whose file is still on its way, and that file is someone's work.
        if (this.drawings && [...state.drawingIds].some((id) => !drawingIds.has(id))) {
            await this.drawings.removeOrphans(projectId, drawingIds);
        }
        state.drawingIds = drawingIds;
        const icon = content.icon ?? null;
        if (content.name !== state.entry.name || content.color !== state.entry.color || !sameIcon(icon, state.entry.icon ?? null)) {
            state.entry = { ...state.entry, name: content.name, color: content.color, icon };
            const entries = await this.loadRegistry();
            await this.saveRegistry(entries.map((entry) => (entry.projectId === projectId ? state.entry : entry)));
            this.publish(state.entry);
        }
        return document.rev;
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

    close(projectId: string): void {
        const state = this.open.get(projectId);
        if (!state) {
            return;
        }
        this.drawings?.closeProject(projectId);
        state.watcher?.close();
        if (state.settle) {
            clearTimeout(state.settle);
        }
        this.open.delete(projectId);
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
        this.close(projectId);
        await this.saveRegistry(entries.filter((candidate) => candidate.projectId !== projectId));
        await rm(this.localPath(projectId), { force: true });
        if (!removeFiles) {
            return;
        }
        if (entry.folder) {
            // Only the canvas file and the drawings that belong to it; the rest of the folder is
            // the person's project. The drawings go first, or the rmdir below finds `.ruimte` full.
            await rm(drawingsDirOf(this.documentPath(entry)), { recursive: true, force: true });
            await rm(this.documentPath(entry), { force: true });
            // `.ruimte` goes only when nothing else is in it: an icon or a file a person put there
            // keeps it, and `rmdir` says so by failing.
            await rmdir(dirname(this.documentPath(entry))).catch(() => undefined);
        } else {
            await rm(dirname(this.documentPath(entry)), { recursive: true, force: true });
        }
    }

    closeAll(): void {
        for (const projectId of [...this.open.keys()]) {
            this.close(projectId);
        }
    }

    private locked<T>(work: () => Promise<T>): Promise<T> {
        const run = this.chain.then(work, work);
        this.chain = run.catch(() => undefined);
        return run;
    }

    /* Where the project file of an open project sits, which is where its drawings sit beside it. */
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
            state.watcher = watch(dirname(path), (_event, filename) => {
                if (filename && filename !== PROJECT_FILE && !isIconFile(filename)) {
                    return;
                }
                // A platform that reports no name could have touched either file.
                state.iconTouched ||= !filename || isIconFile(filename);
                if (state.settle) {
                    clearTimeout(state.settle);
                }
                state.settle = setTimeout(() => {
                    state.settle = null;
                    void this.reload(state, path);
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
        state.entry = { ...state.entry, name: document.name, color: document.color, icon: document.icon ?? null };
        this.emit({ event: 'project.changed', payload: { projectId: state.entry.projectId, document: fromPortable(document, state.entry.folder) } });
        this.publish(state.entry);
    }

    /* Tells every client what a project looks like now; too small a change to ship a document for. */
    private publish(entry: RegistryEntry): void {
        void this.summarize(entry)
            .then((summary) => this.emit({ event: 'project.summary', payload: { summary } }))
            .catch(() => undefined);
    }

    private emit(event: SessionEvent): void {
        for (const sink of this.sinks.values()) {
            sink(event);
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
                console.warn('The project registry would not parse; starting with an empty one', e);
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
