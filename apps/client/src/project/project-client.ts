import type { ProjectContent, ProjectDocument, ProjectIconChoice, ProjectLocal, ProjectSummary, ProjectView } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { dropClientLocal, overlayLocal, readClientLocal, writeClientLocal } from './client-local';
import { browserStorage, readLastProject, rememberProject, type LastProjectStorage } from './last-project';
import { mergeProject, type CanvasAddition } from './merge';
import type { PanelsPort } from './panels-port';

/* The slice of a canvas editor the client reads; the real store has more. */
interface CanvasSlice {
    nodes: Record<string, unknown>;
    texts: Record<string, unknown>;
    edges: unknown[];
    order: string[];
    camera: { x: number; y: number; zoom: number };
    mode: { kind: 'canvas' } | { kind: 'node'; nodeId: string };
    loading: boolean;
}

/*
 * Every canvas on screen, not the one that has the focus: with a grid of cells a save has to follow
 * an edit in any of them. The registry names the view an edit happened in, which the client does not
 * need to know, because what it saves is the whole document either way.
 */
interface CanvasesAccess {
    subscribe(listener: (viewId: string, state: CanvasSlice, previous: CanvasSlice) => void): () => void;
}

/* The slice of the document store the client reads and writes; the real store has more. */
interface DocumentAccess {
    getState(): {
        views: ProjectView[];
        activeViewId: string | null;
        edits: number;
        loading: boolean;
        load(document: ProjectDocument | null, local: ProjectLocal | null): void;
        applyAdditions(views: ProjectView[], canvases: Record<string, CanvasAddition>): void;
        exportViews(): ProjectView[];
        exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views' | 'layout'>;
    };
    subscribe: StoreApi<DocumentAccess extends { getState(): infer S } ? S : never>['subscribe'];
}

export interface ProjectSink {
    /* What this endpoint lists; the store folds it into the union with the other machines'. */
    setProjects(projects: ProjectSummary[]): void;
    /* One row of this endpoint's list, without touching what the other machines listed. */
    patchProject(summary: ProjectSummary): void;
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
        current: ProjectSummary | null;
        rev: number;
        chosenIcon: ProjectIconChoice | null;
        dirty: boolean;
        conflict: ProjectDocument | null;
    };
}

/* The slice of a drawing editor the client watches: its camera is local state like the canvas's. */
interface DrawingSlice {
    camera: { x: number; y: number; zoom: number };
    loading: boolean;
}

interface DrawingsAccess {
    subscribe(listener: (viewId: string, state: DrawingSlice, previous: DrawingSlice) => void): () => void;
}

interface ProjectClientOptions {
    saveDelayMs?: number;
    localDelayMs?: number;
    storage?: LastProjectStorage;
    /* Which daemon the client is talking to; what it remembers about a project is that daemon's. */
    endpointId?: () => string;
    drawings?: DrawingsAccess;
    /* Runs before a project is swapped in, so the drawing on screen reaches its own file first. */
    beforeSwitch?: () => Promise<void>;
    /*
     * Ends what the views still hold on the machine they were opened on. Only a person closing a
     * project reaches this: switching away releases the project and leaves its sessions running.
     */
    endSessions?: (endpointId: string, views: readonly ProjectView[]) => void;
    /* Left out in tests, where there is no window to listen on. */
    window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/* A document without what wraps it: the version and the rev are the daemon's, not the person's. */
const contentOf = (document: ProjectDocument): ProjectContent => {
    const { version: _version, rev: _rev, ...content } = document;
    return content;
};

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/*
 * Keeps the canvas on screen and the project file in step. Edits save after a short pause;
 * the camera and the panels go to this client's storage and the machine-local file on their own,
 * slower clock. A change that
 * arrives from disk replaces the canvas when nothing is unsaved, and otherwise waits for a decision.
 */
export class ProjectClient {
    private readonly transport: Transport;
    private readonly documents: DocumentAccess;
    private readonly panels: PanelsPort;
    private readonly sink: ProjectSink;
    private readonly storage: LastProjectStorage | null;
    private readonly endpointId: () => string;
    private readonly saveDelayMs: number;
    private readonly localDelayMs: number;
    private readonly beforeSwitch: () => Promise<void>;
    private readonly endSessions: (endpointId: string, views: readonly ProjectView[]) => void;
    private readonly unsubscribe: Array<() => void> = [];
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private localTimer: ReturnType<typeof setTimeout> | null = null;
    private saving: Promise<void> | null = null;
    private booted = false;
    private bootTask: Promise<void> | null = null;
    /* What the daemon's file holds at the rev this client is on, which a merge measures against. */
    private base: ProjectContent | null = null;
    /* Why the last incoming document went to the person instead of being merged in. */
    private refusal: string | null = null;

    constructor(
        transport: Transport,
        canvases: CanvasesAccess,
        documents: DocumentAccess,
        panels: PanelsPort,
        sink: ProjectSink,
        options: ProjectClientOptions = {}
    ) {
        this.transport = transport;
        this.documents = documents;
        this.panels = panels;
        this.sink = sink;
        this.storage = options.storage ?? browserStorage();
        this.endpointId = options.endpointId ?? (() => LOCAL_ENDPOINT_ID);
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.localDelayMs = options.localDelayMs ?? 1000;
        this.beforeSwitch = options.beforeSwitch ?? (() => Promise.resolve());
        this.endSessions = options.endSessions ?? ((): void => undefined);
        this.unsubscribe.push(
            transport.on('project.changed', ({ projectId, document }) => this.onChanged(projectId, document)),
            transport.on('project.summary', ({ summary }) => this.applySummary(summary)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            canvases.subscribe((_viewId, state, previous) => this.onCanvas(state, previous)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
            panels.subscribe(() => this.scheduleLocal()),
            ...(options.drawings
                ? [
                      options.drawings.subscribe((_viewId, state, previous) => {
                          if (!state.loading && !previous.loading && state.camera !== previous.camera) {
                              this.scheduleLocal();
                          }
                      })
                  ]
                : [])
        );
        const host = options.window === undefined ? (typeof window === 'undefined' ? null : window) : options.window;
        if (host) {
            // localStorage is synchronous, so a page on its way out still keeps where it stood.
            const onLeave = (): void => this.flushLocal();
            host.addEventListener('pagehide', onLeave);
            this.unsubscribe.push(() => host.removeEventListener('pagehide', onLeave));
        }
        if (transport.status === 'open') {
            this.boot();
        }
    }

    /* Why the last conflict was one; the id in it is what a person needs to make sense of the dialog. */
    get mergeRefusal(): string | null {
        return this.refusal;
    }

    /* Waits for the project this endpoint remembered, so a caller that wants another one does not race it. */
    async settled(): Promise<void> {
        await this.bootTask?.catch(() => undefined);
    }

    async refreshList(): Promise<ProjectSummary[]> {
        const { projects } = await this.transport.request('project.list', {});
        this.sink.setProjects(projects);
        return projects;
    }

    async openProject(projectId: string): Promise<void> {
        await this.open({ projectId });
    }

    /* Creating is browse mode's business: everywhere else a folder that is gone stays gone. */
    async openFolder(folder: string, createFolder = false): Promise<void> {
        await this.open({ folder, createFolder });
    }

    async createProject(name: string): Promise<void> {
        await this.open({ name });
    }

    /*
     * Puts the project away: the sessions of its nodes end on the machine and the canvas is left
     * empty. What is on screen is saved first, so a session goes only after the file it belongs to
     * is on disk, and the views are read before the stores are emptied a few lines down.
     */
    async closeProject(): Promise<void> {
        const current = this.sink.getState().current;
        await this.flush();
        this.flushLocal();
        this.endSessions(this.endpointId(), this.documents.getState().exportViews());
        if (current) {
            await this.transport.request('project.close', { projectId: current.projectId }).catch(() => undefined);
        }
        this.remember(null);
        this.base = null;
        this.documents.getState().load(null, null);
        this.panels.load(null, undefined);
        this.sink.setCurrent(null, 0);
    }

    async deleteProject(projectId: string, removeFiles: boolean): Promise<void> {
        if (this.sink.getState().current?.projectId === projectId) {
            await this.closeProject();
        }
        await this.transport.request('project.delete', { projectId, removeFiles });
        // After the close, which wrote this client's copy on its way out.
        dropClientLocal(this.storage, this.endpointId(), projectId);
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
        this.base = contentOf(conflict);
        if (choice === 'theirs') {
            this.documents.getState().load(conflict, this.localOfScreen());
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

    /* Lets go of the machine: no more events, and no timer that would write to a daemon the client left. */
    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.localTimer) {
            clearTimeout(this.localTimer);
            this.localTimer = null;
        }
    }

    /* What is open on this endpoint now; the other endpoints keep what they had. */
    private remember(projectId: string | null): void {
        rememberProject(this.endpointId(), projectId, this.storage);
    }

    private boot(): void {
        if (this.booted) {
            return;
        }
        this.booted = true;
        this.bootTask = this.runBoot();
    }

    private async runBoot(): Promise<void> {
        try {
            const projects = await this.refreshList();
            const remembered = readLastProject(this.storage, this.endpointId()).byEndpoint[this.endpointId()] ?? null;
            /* Only what was open on this machine before. A machine with nothing remembered stays on
               an empty canvas: opening a project is a choice, not something a boot makes for you. */
            const target = projects.find((project) => project.projectId === remembered && project.available);
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

    private async open(payload: { projectId?: string; folder?: string; name?: string; createFolder?: boolean }): Promise<void> {
        this.sink.setSwitching(true);
        try {
            await this.beforeSwitch();
            await this.flush();
            this.flushLocal();
            const previous = this.sink.getState().current;
            if (previous && previous.projectId !== payload.projectId) {
                // Released, not closed: switching away is not the same as putting a project under Recent.
                await this.transport.request('project.release', { projectId: previous.projectId }).catch(() => undefined);
            }
            const result = await this.transport.request('project.open', payload);
            this.base = contentOf(result.document);
            const local = overlayLocal(result.local, readClientLocal(this.storage, this.endpointId(), result.summary.projectId));
            this.documents.getState().load(result.document, local);
            // In the same tick as the canvas, so the panels never paint the project that just left.
            this.panels.load(result.summary.projectId, local.panels);
            this.sink.setChosenIcon(result.document.icon ?? null);
            this.sink.setCurrent(result.summary, result.document.rev);
            this.remember(result.summary.projectId);
            await this.refreshList();
        } finally {
            this.sink.setSwitching(false);
        }
    }

    private onCanvas(state: CanvasSlice, previous: CanvasSlice): void {
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

    /*
     * Views coming and going are edits; switching between them is not, which is why the store counts
     * the first kind. The view that is open and where its camera stood belong to this client.
     */
    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        if (state.loading || previous.loading || !this.sink.getState().current) {
            return;
        }
        if (state.edits !== previous.edits) {
            this.sink.setDirty(true);
            this.scheduleSave();
        }
        if (state.activeViewId !== previous.activeViewId) {
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
            this.saveLocal();
        }, this.localDelayMs);
    }

    /* Writes what is pending now, so a project that is on its way out takes its own state with it. */
    private flushLocal(): void {
        if (!this.localTimer) {
            return;
        }
        clearTimeout(this.localTimer);
        this.localTimer = null;
        this.saveLocal();
    }

    private saveLocal(): void {
        const current = this.sink.getState().current;
        if (!current) {
            return;
        }
        const local = this.localOfScreen();
        // This client's own copy first: the machine only has to be where a client that never saw the project starts.
        writeClientLocal(this.storage, this.endpointId(), current.projectId, local);
        void this.transport.request('project.save-local', { projectId: current.projectId, local }).catch(() => undefined);
    }

    /* What this client would remember about the project right now: the panels, and every view's camera. */
    private localOfScreen(): ProjectLocal {
        return { ...this.documents.getState().exportLocal(), panels: this.panels.export() };
    }

    private save(): Promise<void> {
        if (this.saving) {
            // One write at a time; the edits made meanwhile ride the next one.
            return this.saving.then(() => (this.sink.getState().dirty ? this.save() : undefined));
        }
        const { current, rev, conflict } = this.sink.getState();
        if (!current || conflict) {
            return Promise.resolve();
        }
        const content = this.contentOfScreen();
        this.sink.setDirty(false);
        this.saving = this.transport
            .request('project.save', { projectId: current.projectId, baseRev: rev, content })
            .then((result) => {
                // The file now holds what went out, which is what the next merge measures against.
                this.base = content;
                this.sink.setRev(result.rev);
                this.sink.setError(null);
            })
            .catch((e: unknown) => {
                this.sink.setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    /* A change that landed while this save was on its way has already been merged in,
                       rev and all, so the write only has to be made again against it. If the rev has
                       not moved the watcher's event is still coming, and carries what to merge with. */
                    if (this.sink.getState().rev !== rev) {
                        this.scheduleSave();
                    }
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
            if (!this.adopt(document)) {
                this.sink.setConflict(document);
            }
            return;
        }
        this.base = contentOf(document);
        this.documents.getState().load(document, this.localOfScreen());
        this.sink.setChosenIcon(document.icon ?? null);
        this.sink.setCurrent({ ...current, name: document.name, color: document.color, icon: document.icon ?? current.icon }, document.rev);
    }

    /*
     * Takes what the daemon added while this client had edits of its own: an agent writing a node is
     * not something to ask a person about. The rev goes along, so the next save is made against the
     * file as it now stands; anything that is not an addition answers false and gets the dialog.
     */
    private adopt(document: ProjectDocument): boolean {
        if (!this.base) {
            return false;
        }
        const merge = mergeProject(this.base, this.contentOfScreen(), contentOf(document));
        if (!merge.ok) {
            this.refusal = merge.reason;
            console.debug(`[project] the canvas could not take in rev ${document.rev}: ${merge.reason}`);
            return false;
        }
        this.refusal = null;
        this.base = contentOf(document);
        this.sink.setRev(document.rev);
        this.documents.getState().applyAdditions(merge.content.views, merge.additions.canvases);
        return true;
    }

    /* The project as it stands on this screen, unsaved edits and all: what a save writes and a merge holds. */
    private contentOfScreen(): ProjectContent {
        const { current, chosenIcon } = this.sink.getState();
        return {
            name: current?.name ?? '',
            color: current?.color ?? '',
            ...(chosenIcon ? { icon: chosenIcon } : {}),
            views: this.documents.getState().exportViews()
        };
    }

    /* The daemon saw a project's icon, name or color change; only the breadcrumb has to follow. */
    private applySummary(summary: ProjectSummary): void {
        const { current } = this.sink.getState();
        this.sink.patchProject(summary);
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
            this.boot();
            return;
        }
        this.booted = false;
    }
}
