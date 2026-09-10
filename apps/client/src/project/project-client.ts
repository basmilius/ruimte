import type { ProjectContent, ProjectDocument, ProjectIconChoice, ProjectLocal, ProjectSummary } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';

const LAST_PROJECT_KEY = 'ruimte.lastProject';

/* The slice of the canvas store the client reads and writes; the real store has more. */
interface CanvasAccess {
    getState(): {
        nodes: Record<string, unknown>;
        texts: Record<string, unknown>;
        edges: unknown[];
        order: string[];
        camera: { x: number; y: number; zoom: number };
        mode: { kind: 'canvas' } | { kind: 'node'; nodeId: string };
        loading: boolean;
        loadDocument(document: ProjectDocument | null, local: ProjectLocal | null): void;
        exportContent(): Pick<ProjectContent, 'nodes' | 'texts' | 'edges' | 'layouts'>;
    };
    subscribe: StoreApi<CanvasAccess extends { getState(): infer S } ? S : never>['subscribe'];
}

export interface ProjectSink {
    setProjects(projects: ProjectSummary[]): void;
    setCurrent(current: ProjectSummary | null, rev: number): void;
    setRev(rev: number): void;
    setChosenIcon(chosenIcon: ProjectIconChoice | null): void;
    /* Replaces what is shown for the current project without touching the save state. */
    setSummary(summary: ProjectSummary): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: ProjectDocument | null): void;
    setError(error: string | null): void;
    setSwitching(switching: boolean): void;
    getState(): {
        projects: ProjectSummary[];
        current: ProjectSummary | null;
        rev: number;
        chosenIcon: ProjectIconChoice | null;
        dirty: boolean;
        conflict: ProjectDocument | null;
    };
}

interface ProjectClientOptions {
    saveDelayMs?: number;
    localDelayMs?: number;
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/*
 * Keeps the canvas on screen and the project file in step. Edits save after a short pause;
 * the camera goes to the machine-local file on its own, slower clock. A change that arrives
 * from disk replaces the canvas when nothing is unsaved, and otherwise waits for a decision.
 */
export class ProjectClient {
    private readonly transport: Transport;
    private readonly canvas: CanvasAccess;
    private readonly sink: ProjectSink;
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
    private readonly saveDelayMs: number;
    private readonly localDelayMs: number;
    private readonly unsubscribe: Array<() => void> = [];
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private localTimer: ReturnType<typeof setTimeout> | null = null;
    private saving: Promise<void> | null = null;
    private booted = false;

    constructor(transport: Transport, canvas: CanvasAccess, sink: ProjectSink, options: ProjectClientOptions = {}) {
        this.transport = transport;
        this.canvas = canvas;
        this.sink = sink;
        this.storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.localDelayMs = options.localDelayMs ?? 1000;
        this.unsubscribe.push(
            transport.on('project.changed', ({ projectId, document }) => this.onChanged(projectId, document)),
            transport.on('project.summary', ({ summary }) => this.applySummary(summary)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            canvas.subscribe((state, previous) => this.onCanvas(state, previous))
        );
        if (transport.status === 'open') {
            void this.boot();
        }
    }

    async refreshList(): Promise<ProjectSummary[]> {
        const { projects } = await this.transport.request('project.list', {});
        this.sink.setProjects(projects);
        return projects;
    }

    async openProject(projectId: string): Promise<void> {
        await this.open({ projectId });
    }

    async openFolder(folder: string): Promise<void> {
        await this.open({ folder });
    }

    async createProject(name: string): Promise<void> {
        await this.open({ name });
    }

    /* Leaves the canvas empty; the sessions of the nodes keep running on the daemon. */
    async closeProject(): Promise<void> {
        const current = this.sink.getState().current;
        await this.flush();
        if (current) {
            await this.transport.request('project.close', { projectId: current.projectId }).catch(() => undefined);
        }
        this.storage?.removeItem(LAST_PROJECT_KEY);
        this.canvas.getState().loadDocument(null, null);
        this.sink.setCurrent(null, 0);
    }

    async deleteProject(projectId: string, removeFiles: boolean): Promise<void> {
        if (this.sink.getState().current?.projectId === projectId) {
            await this.closeProject();
        }
        await this.transport.request('project.delete', { projectId, removeFiles });
        await this.refreshList();
    }

    async rename(name: string, color?: string): Promise<void> {
        const current = this.sink.getState().current;
        if (!current) {
            return;
        }
        this.sink.setCurrent({ ...current, name, color: color ?? current.color }, this.sink.getState().rev);
        this.sink.setDirty(true);
        this.scheduleSave();
    }

    /* An emoji or a Lucide name goes into the shared file; null means "use what the folder declares". */
    async setChosenIcon(icon: ProjectIconChoice | null): Promise<void> {
        const current = this.sink.getState().current;
        if (!current) {
            return;
        }
        this.sink.setChosenIcon(icon);
        // The choice is what the daemon would resolve too, so the glyph does not wait for a round trip.
        if (icon) {
            this.sink.setSummary({ ...current, icon });
        }
        this.sink.setDirty(true);
        await this.flush();
        if (!icon) {
            await this.resolveFolderIcon(current.projectId);
        }
    }

    /* Writes `<folder>/.ruimte/icon.<ext>` and lets the folder be what the glyph shows. */
    async uploadIcon(mime: string, base64: string): Promise<void> {
        const current = this.sink.getState().current;
        if (!current) {
            return;
        }
        await this.setChosenIcon(null);
        const { summary } = await this.transport.request('project.setIcon', { projectId: current.projectId, image: { mime, base64 } });
        this.applySummary(summary);
    }

    /* Drops the choice and the file the app wrote, so the rest of the folder gets its turn again. */
    async useFolderIcon(): Promise<void> {
        const current = this.sink.getState().current;
        if (!current) {
            return;
        }
        await this.setChosenIcon(null);
        const { summary } = await this.transport.request('project.setIcon', { projectId: current.projectId, image: null });
        this.applySummary(summary);
    }

    /* Takes what is on disk, or keeps the screen and writes it over the file's newer rev. */
    async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
        const { conflict, current } = this.sink.getState();
        if (!conflict || !current) {
            return;
        }
        this.sink.setConflict(null);
        if (choice === 'theirs') {
            this.canvas.getState().loadDocument(conflict, { camera: this.canvas.getState().camera, focusedNodeId: null });
            this.sink.setChosenIcon(conflict.icon ?? null);
            this.sink.setCurrent({ ...current, name: conflict.name, color: conflict.color, icon: conflict.icon ?? current.icon }, conflict.rev);
            return;
        }
        this.sink.setRev(conflict.rev);
        this.sink.setDirty(true);
        await this.flush();
    }

    /* Writes pending edits now; used before closing or switching. */
    async flush(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.sink.getState().dirty) {
            await this.save();
        } else if (this.saving) {
            await this.saving;
        }
    }

    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
    }

    private async boot(): Promise<void> {
        if (this.booted) {
            return;
        }
        this.booted = true;
        try {
            const projects = await this.refreshList();
            const remembered = this.storage?.getItem(LAST_PROJECT_KEY) ?? null;
            // The daemon always lists at least one canvas; nothing to create from here.
            const target = projects.find((project) => project.projectId === remembered && project.available) ?? projects.find((project) => project.available);
            if (target) {
                await this.open({ projectId: target.projectId });
            }
        } catch (e) {
            this.booted = false;
            if (!isConnectionError(e)) {
                this.sink.setError(e instanceof Error ? e.message : 'The project could not be opened');
            }
        }
    }

    private async open(payload: { projectId?: string; folder?: string; name?: string }): Promise<void> {
        this.sink.setSwitching(true);
        try {
            await this.flush();
            const previous = this.sink.getState().current;
            if (previous && previous.projectId !== payload.projectId) {
                await this.transport.request('project.close', { projectId: previous.projectId }).catch(() => undefined);
            }
            const result = await this.transport.request('project.open', payload);
            this.canvas.getState().loadDocument(result.document, result.local);
            this.sink.setChosenIcon(result.document.icon ?? null);
            this.sink.setCurrent(result.summary, result.document.rev);
            this.storage?.setItem(LAST_PROJECT_KEY, result.summary.projectId);
            await this.refreshList();
        } finally {
            this.sink.setSwitching(false);
        }
    }

    private onCanvas(state: ReturnType<CanvasAccess['getState']>, previous: ReturnType<CanvasAccess['getState']>): void {
        if (state.loading || previous.loading || !this.sink.getState().current) {
            return;
        }
        if (state.nodes !== previous.nodes || state.texts !== previous.texts || state.edges !== previous.edges || state.order !== previous.order) {
            this.sink.setDirty(true);
            this.scheduleSave();
        }
        if (state.camera !== previous.camera || state.mode !== previous.mode) {
            this.scheduleLocal();
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, this.saveDelayMs);
    }

    private scheduleLocal(): void {
        if (this.localTimer) {
            clearTimeout(this.localTimer);
        }
        this.localTimer = setTimeout(() => {
            this.localTimer = null;
            const current = this.sink.getState().current;
            if (!current) {
                return;
            }
            const { camera, mode } = this.canvas.getState();
            void this.transport
                .request('project.save-local', { projectId: current.projectId, local: { camera, focusedNodeId: mode.kind === 'node' ? mode.nodeId : null } })
                .catch(() => undefined);
        }, this.localDelayMs);
    }

    private save(): Promise<void> {
        if (this.saving) {
            // One write at a time; the edits made meanwhile ride the next one.
            return this.saving.then(() => (this.sink.getState().dirty ? this.save() : undefined));
        }
        const { current, rev, conflict, chosenIcon } = this.sink.getState();
        if (!current || conflict) {
            return Promise.resolve();
        }
        const content: ProjectContent = {
            name: current.name,
            color: current.color,
            ...(chosenIcon ? { icon: chosenIcon } : {}),
            ...this.canvas.getState().exportContent()
        };
        this.sink.setDirty(false);
        this.saving = this.transport
            .request('project.save', { projectId: current.projectId, baseRev: rev, content })
            .then((result) => {
                this.sink.setRev(result.rev);
                this.sink.setError(null);
            })
            .catch((e: unknown) => {
                this.sink.setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // The watcher's event carries the newer document; nothing to do until it arrives.
                    return;
                }
                if (!isConnectionError(e)) {
                    this.sink.setError(e instanceof Error ? e.message : 'The canvas could not be saved');
                }
            })
            .finally(() => {
                this.saving = null;
            });
        return this.saving;
    }

    private onChanged(projectId: string, document: ProjectDocument): void {
        const { current, dirty } = this.sink.getState();
        if (!current || current.projectId !== projectId) {
            return;
        }
        if (dirty || this.saving) {
            this.sink.setConflict(document);
            return;
        }
        this.canvas.getState().loadDocument(document, { camera: this.canvas.getState().camera, focusedNodeId: null });
        this.sink.setChosenIcon(document.icon ?? null);
        this.sink.setCurrent({ ...current, name: document.name, color: document.color, icon: document.icon ?? current.icon }, document.rev);
    }

    /* The daemon saw a project's icon, name or color change; only the breadcrumb has to follow. */
    private applySummary(summary: ProjectSummary): void {
        const { projects, current } = this.sink.getState();
        this.sink.setProjects(projects.map((project) => (project.projectId === summary.projectId ? summary : project)));
        if (current?.projectId === summary.projectId) {
            this.sink.setSummary(summary);
        }
    }

    private async resolveFolderIcon(projectId: string): Promise<void> {
        const projects = await this.refreshList().catch(() => null);
        const summary = projects?.find((project) => project.projectId === projectId);
        if (summary) {
            this.applySummary(summary);
        }
    }

    private onStatus(status: TransportStatus): void {
        if (status === 'open') {
            void this.boot();
            return;
        }
        this.booted = false;
    }
}
