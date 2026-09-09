import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
    ProjectLocalSchema,
    type ProjectContent,
    type ProjectDocument,
    type ProjectLocal,
    type ProjectOpenPayload,
    type ProjectOpenResult,
    type ProjectSummary
} from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { documentPathInFolder, fromPortable, parseDocument, readDocument, toPortable, writeDocument, PROJECT_FILE } from './project-files.ts';

export type ProjectErrorCode = 'project-not-found' | 'project-missing' | 'rev-conflict' | 'folder-not-found';

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
    lastOpenedAt: z.number()
});
type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

const RegistrySchema = z.object({ projects: z.array(RegistryEntrySchema) });

// Editors and git write in bursts; one event per burst is what the client wants.
const WATCH_SETTLE_MS = 150;

const DEFAULT_COLOR = '#7c74ff';
const EMPTY_LOCAL: ProjectLocal = { camera: null, focusedNodeId: null };

const newId = (): string => randomBytes(6).toString('base64url');

interface OpenProject {
    entry: RegistryEntry;
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
    watcher: FSWatcher | null;
    settle: ReturnType<typeof setTimeout> | null;
}

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
    // Registry changes run one after the other; two clients opening at once must not lose an entry.
    private chain: Promise<unknown> = Promise.resolve();

    constructor(home: string) {
        this.home = home;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    async list(): Promise<ProjectSummary[]> {
        await this.locked(async () => {
            // A daemon that knows no canvas makes one, so every client boots into the same project.
            if ((await this.loadRegistry()).length === 0) {
                await this.openUnlocked({ name: 'Untitled canvas' });
            }
        });
        const entries = await this.loadRegistry();
        return Promise.all(
            entries.map(async (entry) => ({
                ...entry,
                available: entry.folder === null || (await exists(this.documentPath(entry)))
            }))
        );
    }

    openProject(payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        return this.locked(() => this.openUnlocked(payload));
    }

    private async openUnlocked(payload: ProjectOpenPayload): Promise<ProjectOpenResult> {
        const entries = await this.loadRegistry();
        let entry: RegistryEntry | undefined;
        if (payload.projectId) {
            entry = entries.find((candidate) => candidate.projectId === payload.projectId);
            if (!entry) {
                throw new ProjectError('project-not-found', `No project ${payload.projectId}`);
            }
        } else if (payload.folder) {
            const folder = resolve(payload.folder);
            if (!(await isDirectory(folder))) {
                throw new ProjectError('folder-not-found', `${folder} is not a folder`);
            }
            entry = entries.find((candidate) => candidate.folder === folder) ?? {
                projectId: newId(),
                name: payload.name ?? basename(folder),
                color: payload.color ?? DEFAULT_COLOR,
                folder,
                lastOpenedAt: Date.now()
            };
        } else {
            entry = {
                projectId: newId(),
                name: payload.name ?? 'Untitled canvas',
                color: payload.color ?? DEFAULT_COLOR,
                folder: null,
                lastOpenedAt: Date.now()
            };
        }

        const path = this.documentPath(entry);
        let outcome = await readDocument(path);
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
            document = { version: 1, rev: 0, name: entry.name, color: entry.color, nodes: [], texts: [], edges: [], layouts: [] };
            text = await writeDocument(path, document);
        }

        entry = { ...entry, name: document.name, color: document.color, lastOpenedAt: Date.now() };
        await this.saveRegistry([...entries.filter((candidate) => candidate.projectId !== entry!.projectId), entry]);

        this.close(entry.projectId);
        const state: OpenProject = { entry, rev: document.rev, lastText: text, watcher: null, settle: null };
        this.open.set(entry.projectId, state);
        this.startWatching(state, path);

        return {
            summary: { ...entry, available: true },
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
        const document: ProjectDocument = { version: 1, rev: state.rev + 1, ...toPortable(content, state.entry.folder) };
        state.lastText = await writeDocument(this.documentPath(state.entry), document);
        state.rev = document.rev;
        if (content.name !== state.entry.name || content.color !== state.entry.color) {
            state.entry = { ...state.entry, name: content.name, color: content.color };
            const entries = await this.loadRegistry();
            await this.saveRegistry(entries.map((entry) => (entry.projectId === projectId ? state.entry : entry)));
        }
        return document.rev;
    }

    async saveLocal(projectId: string, local: ProjectLocal): Promise<void> {
        await mkdir(join(this.home, 'projects'), { recursive: true, mode: 0o700 });
        await writeAtomic(this.localPath(projectId), JSON.stringify(local));
    }

    close(projectId: string): void {
        const state = this.open.get(projectId);
        if (!state) {
            return;
        }
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
            // Only the canvas file; the folder is the person's project, not ours.
            await rm(this.documentPath(entry), { force: true });
            await rm(dirname(this.documentPath(entry)), { force: true, recursive: false }).catch(() => undefined);
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

    private documentPath(entry: RegistryEntry): string {
        return entry.folder ? documentPathInFolder(entry.folder) : join(this.home, 'projects', encodeURIComponent(entry.projectId), PROJECT_FILE);
    }

    private localPath(projectId: string): string {
        return join(this.home, 'projects', `${encodeURIComponent(projectId)}.local.json`);
    }

    private async readLocal(projectId: string): Promise<ProjectLocal> {
        try {
            const parsed = ProjectLocalSchema.safeParse(JSON.parse(await readFile(this.localPath(projectId), 'utf8')));
            return parsed.success ? parsed.data : EMPTY_LOCAL;
        } catch {
            return EMPTY_LOCAL;
        }
    }

    private startWatching(state: OpenProject, path: string): void {
        try {
            // The directory, not the file: an atomic rename replaces the inode a file watcher would hold.
            state.watcher = watch(dirname(path), (_event, filename) => {
                if (filename && filename !== PROJECT_FILE) {
                    return;
                }
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
        let text: string;
        try {
            text = await readFile(path, 'utf8');
        } catch {
            return;
        }
        if (text === state.lastText) {
            return;
        }
        const document = parseDocument(text);
        if (!document) {
            // Half-written by someone else; the event that follows the finished write reads it whole.
            return;
        }
        state.lastText = text;
        state.rev = document.rev;
        state.entry = { ...state.entry, name: document.name, color: document.color };
        const payload = { projectId: state.entry.projectId, document: fromPortable(document, state.entry.folder) };
        for (const sink of this.sinks.values()) {
            sink({ event: 'project.changed', payload });
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
