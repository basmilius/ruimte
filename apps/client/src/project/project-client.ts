import i18next from 'i18next';
import type { ProjectContent, ProjectDocument, ProjectIconChoice, ProjectLocal, ProjectSummary, ProjectView } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { isConnectionError, TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { forgetClosedProject, rememberClosedProject } from './closed-projects';
import { overlayLocal, readClientLocal, withoutClientBrowserState, writeClientLocal } from './client-local';
import { browserStorage, rememberProject, type LastProjectStorage } from './last-project';
import { mergeProject, type CanvasPatch } from './merge';
import type { PanelsPort } from './panels-port';

/* The slice of a canvas editor the client reads; the real store has more. */
interface CanvasSlice {
    nodes: Record<string, unknown>;
    texts: Record<string, unknown>;
    edges: unknown[];
    order: string[];
    camera: { x: number; y: number; zoom: number };
    bodyFocusId: string | null;
    loading: boolean;
}

/*
 * Every canvas on screen, not the one that has the focus. With a grid of cells a save has to follow
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
        shared: string[];
        activeViewId: string | null;
        edits: number;
        loading: boolean;
        load(document: ProjectDocument | null, local: ProjectLocal | null): void;
        applyMerge(views: ProjectView[], canvases: Record<string, CanvasPatch>, shared: string[]): void;
        heldNodeIds(): Set<string>;
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

/* The slice of a drawing editor the client watches. Its camera is local state like the canvas's. */
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
    /* A diagram keeps its camera in its own editor the way a drawing does. */
    diagrams?: DrawingsAccess;
    /* Runs before the project is left for another one, so the drawing on screen reaches its own file first. */
    beforeLeave?: () => Promise<void>;
    /* Runs in the tick the opened project reaches the stores, so the window shows it with nothing in between. */
    onLoad?: () => void;
    /* Drops what this client cached for the views of a project it is putting away. */
    forgetSessions?: (endpointId: string, views: readonly ProjectView[]) => void;
    /* Runs once the project is open on the daemon again after the link came back, so the drawings on screen can follow. */
    afterResume?: () => Promise<void>;
    /* Left out in tests, where there is no window to listen on. */
    window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/* A document without what wraps it. The version and the rev are the daemon's, not the person's. */
const contentOf = (document: ProjectDocument): ProjectContent => {
    const { version: _version, rev: _rev, ...content } = document;
    return content;
};

/*
 * Synchronizes one workspace with its project file. Shared edits debounce to the daemon, local view
 * state saves separately, and incoming revisions merge unless both sides changed the same field.
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
    private readonly beforeLeave: () => Promise<void>;
    private readonly onLoad: () => void;
    private readonly forgetSessions: (endpointId: string, views: readonly ProjectView[]) => void;
    private readonly afterResume: () => Promise<void>;
    private readonly unsubscribe: Array<() => void> = [];
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private localTimer: ReturnType<typeof setTimeout> | null = null;
    private saving: Promise<void> | null = null;
    /*
     * Its own project reached the stores. Until then the stores may still hold the project this client
     * replaces, and an edit there is not this client's to save on its machine.
     */
    private opened = false;
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
        this.beforeLeave = options.beforeLeave ?? (() => Promise.resolve());
        this.onLoad = options.onLoad ?? ((): void => undefined);
        this.forgetSessions = options.forgetSessions ?? ((): void => undefined);
        this.afterResume = options.afterResume ?? (() => Promise.resolve());
        this.unsubscribe.push(
            transport.on('project.changed', ({ projectId, document }) => this.onChanged(projectId, document)),
            transport.on('project.summary', ({ summary }) => this.applySummary(summary)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            canvases.subscribe((_viewId, state, previous) => this.onCanvas(state, previous)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
            panels.subscribe(() => this.scheduleLocal()),
            ...[options.drawings, options.diagrams].flatMap((editors) =>
                editors
                    ? [
                          editors.subscribe((_viewId, state, previous) => {
                              if (!state.loading && !previous.loading && state.camera !== previous.camera) {
                                  this.scheduleLocal();
                              }
                          })
                      ]
                    : []
            )
        );
        const host = options.window === undefined ? (typeof window === 'undefined' ? null : window) : options.window;
        if (host) {
            // localStorage is synchronous, so a page on its way out still keeps where it stood.
            const onLeave = (): void => this.flushLocal();
            host.addEventListener('pagehide', onLeave);
            this.unsubscribe.push(() => host.removeEventListener('pagehide', onLeave));
        }
    }

    /* Why the last conflict was one; the id in it is what a person needs to make sense of the dialog. */
    get mergeRefusal(): string | null {
        return this.refusal;
    }

    async refreshList(): Promise<ProjectSummary[]> {
        const { projects } = await this.transport.request('project.list', {});
        this.sink.setProjects(projects);
        return projects;
    }

    async openProject(projectId: string): Promise<void> {
        await this.open({ projectId });
    }

    /* Creating is browse mode's business. Everywhere else a folder that is gone stays gone. */
    async openFolder(folder: string, createFolder = false): Promise<void> {
        await this.open({ folder, createFolder });
    }

    /*
     * Lets go of the project for another one. What is on screen is written first, and the daemon is told
     * the project is released rather than closed, since switching away does not put it under Recent.
     * The stores keep what they hold, for the next client to load over.
     */
    async leave(): Promise<void> {
        const current = this.opened ? this.sink.getState().current : null;
        await this.beforeLeave();
        await this.flush();
        this.flushLocal();
        this.opened = false;
        if (current) {
            await this.transport.request('project.release', { projectId: current.projectId }).catch(() => undefined);
        }
    }

    /*
     * Puts this project away. What is on screen is written first, so the daemon counts and ends the
     * sessions of the document as it stands. Whether anything ends is the daemon's call: another
     * client with the same project open keeps it running. Closing is this client's either way, so
     * the row moves under Recent here even while the machine still has the project in use.
     */
    async closeProject(): Promise<void> {
        const current = this.sink.getState().current;
        await this.flush();
        this.flushLocal();
        if (current) {
            this.forgetSessions(this.endpointId(), this.documents.getState().exportViews());
            if (this.transport.status === 'open') {
                await this.transport.request('project.close', { projectId: current.projectId }).catch(() => undefined);
            }
            rememberClosedProject(this.endpointId(), current.projectId, this.storage);
            this.sink.patchProject({ ...current, closedAt: Date.now() });
        }
        this.remember(null);
        this.opened = false;
        this.base = null;
        this.documents.getState().load(null, null);
        this.panels.load(null, undefined);
        this.sink.setCurrent(null, 0);
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

    /* A Lucide name goes into the shared file; null means "use what the folder declares". */
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

    /* Lets go of the machine. No more events, and no timer that would write to a daemon the client left. */
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

    private async open(payload: { projectId?: string; folder?: string; name?: string; createFolder?: boolean }): Promise<void> {
        this.sink.setSwitching(true);
        try {
            const result = await this.transport.request('project.open', payload);
            forgetClosedProject(this.endpointId(), result.summary.projectId, this.storage);
            this.base = contentOf(result.document);
            const local = overlayLocal(result.local, readClientLocal(this.storage, this.endpointId(), result.summary.projectId));
            this.onLoad();
            this.opened = true;
            this.documents.getState().load(result.document, local);
            // In the same tick as the canvas, so the panels never paint the project that just left.
            this.panels.load(result.summary.projectId, local.panels);
            this.sink.setChosenIcon(result.document.icon ?? null);
            this.sink.setCurrent(result.summary, result.document.rev);
            this.remember(result.summary.projectId);
            // The project is open whatever the list says; a list that did not come is asked again when the link opens.
            await this.refreshList().catch(() => undefined);
        } finally {
            this.sink.setSwitching(false);
        }
    }

    private onCanvas(state: CanvasSlice, previous: CanvasSlice): void {
        if (state.loading || previous.loading || !this.opened || !this.sink.getState().current) {
            return;
        }
        if (state.nodes !== previous.nodes || state.texts !== previous.texts || state.edges !== previous.edges || state.order !== previous.order) {
            this.sink.setDirty(true);
            this.scheduleSave();
        }
        // Where the keyboard sits is what the local file keeps as the view's focused node.
        if (state.camera !== previous.camera || state.bodyFocusId !== previous.bodyFocusId) {
            this.scheduleLocal();
        }
    }

    /*
     * Views coming and going are edits; switching between them is not, which is why the store counts
     * the first kind. The view that is open and where its camera stood belong to this client.
     */
    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        if (state.loading || previous.loading || !this.opened || !this.sink.getState().current) {
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
        if (!this.opened || !current) {
            return;
        }
        const local = this.localOfScreen();
        // This client's own copy first, so the machine only has to be where a client that never saw the project starts.
        writeClientLocal(this.storage, this.endpointId(), current.projectId, local);
        if (this.transport.status === 'open') {
            void this.transport.request('project.save-local', { projectId: current.projectId, local: withoutClientBrowserState(local) }).catch(() => undefined);
        }
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
        // A link that is down keeps the edit dirty for the resume to write, rather than a request that can only fail.
        if (!this.opened || !current || conflict || this.transport.status !== 'open') {
            return Promise.resolve();
        }
        const content = this.contentOfScreen();
        const shared = [...this.documents.getState().shared];
        this.sink.setDirty(false);
        this.saving = this.transport
            .request('project.save', { projectId: current.projectId, baseRev: rev, content, shared })
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
                    this.sink.setError(e instanceof Error ? e.message : i18next.t('project:error.projectNotSaved'));
                }
            })
            .finally(() => {
                this.saving = null;
            });
        return this.saving;
    }

    private onChanged(projectId: string, document: ProjectDocument): void {
        const { current, dirty } = this.sink.getState();
        if (!this.opened || !current || current.projectId !== projectId) {
            return;
        }
        /* Merged first on a clean screen too. A load swaps every editor out and blanks the canvas
           until it is measured, which a view renamed in another client should not cost. */
        if (this.adopt(document)) {
            return;
        }
        if (dirty || this.saving) {
            this.sink.setConflict(document);
            return;
        }
        this.base = contentOf(document);
        this.documents.getState().load(document, this.localOfScreen());
        this.sink.setChosenIcon(document.icon ?? null);
        this.sink.setCurrent({ ...current, name: document.name, color: document.color, icon: document.icon ?? current.icon }, document.rev);
    }

    /*
     * Takes in what another writer changed, beside this client's own edits. An agent adding a node or
     * a second client moving one is not something to ask a person about. The rev goes along, so the
     * next save is made against the file as it now stands; a real conflict answers false and gets the
     * dialog (or, on a clean screen, the whole document).
     */
    private adopt(document: ProjectDocument): boolean {
        if (!this.base) {
            return false;
        }
        const merge = mergeProject(this.base, this.contentOfScreen(), contentOf(document), this.documents.getState().heldNodeIds());
        if (!merge.ok) {
            this.refusal = merge.reason;
            console.debug(`[project] the canvas could not take in rev ${document.rev}: ${merge.reason}`);
            return false;
        }
        this.refusal = null;
        this.base = contentOf(document);
        this.sink.setRev(document.rev);
        /* Which file a view is in is the folder's answer and not this screen's. A colleague's pull
           can share one, and nothing here may argue with what the daemon just read off disk. */
        this.documents.getState().applyMerge(merge.content.views, merge.changes.canvases, document.shared ?? []);
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
        if (this.opened && current?.projectId === summary.projectId) {
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
        if (status === 'open' && this.opened && this.sink.getState().current) {
            void this.resume();
        }
    }

    /*
     * The link came back with a project on screen. The daemon is asked for it again, since one that
     * restarted holds nothing open, but its document only reaches the screen when the file moved on
     * meanwhile, through the same path as any change from disk. The editors, the grid and the cameras
     * stay as they are, and the edits made while the link was down go out now.
     */
    private async resume(): Promise<void> {
        const current = this.sink.getState().current;
        if (!current) {
            return;
        }
        try {
            const result = await this.transport.request('project.open', { projectId: current.projectId });
            if (this.sink.getState().current?.projectId !== current.projectId) {
                return;
            }
            if (result.document.rev !== this.sink.getState().rev) {
                this.onChanged(current.projectId, result.document);
            }
            await this.flush();
            this.saveLocal();
            await this.afterResume();
            await this.refreshList();
        } catch (e) {
            if (!isConnectionError(e)) {
                this.sink.setError(e instanceof Error ? e.message : i18next.t('project:error.reopenFailed'));
            }
        }
    }
}
