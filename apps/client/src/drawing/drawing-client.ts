import {
    isDrawingView,
    type DrawingDocument,
    type ProjectLocal,
    type ProjectSummary,
    type ProjectView,
    type ProjectViewLocal,
    type SplitLayout
} from '@ruimte/contracts';
import i18next from 'i18next';
import type { StoreApi } from 'zustand';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import type { DrawingState } from '@/state/drawing';
import type { EditorRegistry } from '@/state/editors';
import { viewIdsIn } from '@/shell/split';

type DrawingStore = StoreApi<DrawingState>;

/* The slice of the document store this client reads; the real store has more. */
interface DocumentAccess {
    getState(): {
        views: ProjectView[];
        activeViewId: string | null;
        /* Which views the grid has on screen; every drawing among them is one the daemon holds open. */
        layout: SplitLayout | null;
        viewLocal: Record<string, ProjectViewLocal>;
        loading: boolean;
        exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views' | 'layout'>;
    };
    subscribe: StoreApi<DocumentAccess extends { getState(): infer S } ? S : never>['subscribe'];
}

interface ProjectAccess {
    getState(): { current: ProjectSummary | null; switching: boolean };
    subscribe: StoreApi<ProjectAccess extends { getState(): infer S } ? S : never>['subscribe'];
}

interface DrawingClientOptions {
    saveDelayMs?: number;
    /* Writes the project file first, so the daemon knows the view before its drawing is asked for. */
    flushProject?: () => Promise<void>;
    /* Left out in tests, where there is no window to listen on. */
    window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
    document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/* One drawing the daemon has open for this client, with everything a save of that one file needs. */
interface OpenDrawing {
    projectId: string;
    viewId: string;
    store: DrawingStore;
    saveTimer: ReturnType<typeof setTimeout> | null;
    saving: Promise<void> | null;
    /* Rises on every open, so a document that arrives late never lands on the drawing after it. */
    generation: number;
    /* The rev a refused save was already tried again on, so a refusal never turns into a circle. */
    retriedRev: number | null;
}

/*
 * Keeps the drawing on screen and its file in step, the way `ProjectClient` does for the project.
 * It follows the active view: a drawing coming up is opened and loaded, one going away is written
 * out first. Edits save after a short pause, one write at a time, always against the rev that was
 * loaded; a file that moved on in the meantime goes to the banner.
 */
export class DrawingClient {
    private readonly transport: Transport;
    /*
     * The drawing editors of this workspace. The client is what opens and closes one: a drawing is a
     * file of its own with a rev of its own, so its editor lives exactly as long as the daemon holds
     * it open, which is not the same span as the view being in the grid.
     */
    private readonly drawings: EditorRegistry<DrawingState>;
    private readonly documents: DocumentAccess;
    private readonly projects: ProjectAccess;
    private readonly saveDelayMs: number;
    private readonly flushProject: () => Promise<void>;
    private readonly unsubscribe: Array<() => void> = [];
    /* Every drawing on screen, by view id. The grid can hold more than one at a time, and each is a
       file of its own with a rev of its own, so everything a save needs is kept per drawing. */
    private readonly open = new Map<string, OpenDrawing>();
    /* The socket went away, so the daemon may have forgotten these drawings while it was gone. */
    private reconnecting = false;

    constructor(
        transport: Transport,
        drawings: EditorRegistry<DrawingState>,
        documents: DocumentAccess,
        projects: ProjectAccess,
        options: DrawingClientOptions = {}
    ) {
        this.transport = transport;
        this.drawings = drawings;
        this.documents = documents;
        this.projects = projects;
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.flushProject = options.flushProject ?? (() => Promise.resolve());
        this.unsubscribe.push(
            transport.on('drawing.changed', ({ projectId, viewId, document }) => this.onChanged(projectId, viewId, document)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
            projects.subscribe((state, previous) => this.onProject(state, previous)),
            drawings.subscribe((viewId, state, previous) => this.onDrawing(viewId, state, previous))
        );
        const host = options.window === undefined ? (typeof window === 'undefined' ? null : window) : options.window;
        if (host) {
            // A drawing is closed mid-stroke more often than a canvas is; a best-effort send beats none.
            const onLeave = (): void => void this.flush();
            host.addEventListener('beforeunload', onLeave);
            this.unsubscribe.push(() => host.removeEventListener('beforeunload', onLeave));
        }
        const page = options.document === undefined ? (typeof document === 'undefined' ? null : document) : options.document;
        if (page) {
            const onHidden = (): void => {
                if (page.visibilityState === 'hidden') {
                    void this.flush();
                }
            };
            page.addEventListener('visibilitychange', onHidden);
            this.unsubscribe.push(() => page.removeEventListener('visibilitychange', onHidden));
        }
        void this.sync();
    }

    /* The drawing of the cell that has the focus, which is the one a banner or a menu is about. */
    private get focused(): OpenDrawing | null {
        const { activeViewId } = this.documents.getState();
        return activeViewId === null ? null : (this.open.get(activeViewId) ?? null);
    }

    /* Writes pending edits now; used before a view switch, a project switch and on the way out. */
    async flush(): Promise<void> {
        await Promise.all([...this.open.values()].map((drawing) => this.flushOne(drawing)));
    }

    private async flushOne(drawing: OpenDrawing): Promise<void> {
        this.cancelSave(drawing);
        if (drawing.store.getState().dirty) {
            await this.save(drawing);
        } else if (drawing.saving) {
            await drawing.saving;
        }
    }

    /*
     * The link came back while the project stayed on screen. The daemon may have forgotten every
     * drawing while it was gone, and an edit made meanwhile is still waiting to be written.
     */
    async resume(): Promise<void> {
        if (!this.reconnecting) {
            return;
        }
        this.reconnecting = false;
        await Promise.all([...this.open.values()].map((drawing) => this.reopen(drawing)));
    }

    /* Copies the elements of one drawing view into another, which is what duplicating a view is. */
    async copy(from: string, to: string): Promise<void> {
        const projectId = this.projects.getState().current?.projectId;
        if (!projectId) {
            return;
        }
        await this.flush();
        await this.flushProject();
        await this.transport
            .request('drawing.copy', { projectId, from, to })
            .catch((e: unknown) => this.report(null, e, i18next.t('drawing:error.drawingCopy')));
    }

    /* Takes what is on disk, or keeps the screen and writes it over the file's newer rev. */
    async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
        // The banner stands in one cell, so the answer is about the drawing in the cell with the focus.
        const drawing = this.focused ?? [...this.open.values()].find((each) => each.store.getState().conflict !== null) ?? null;
        const state = drawing?.store.getState();
        const conflict = state?.conflict;
        if (!drawing || !state || !conflict) {
            return;
        }
        state.setConflict(null);
        if (choice === 'theirs') {
            // The edit that caused the conflict still has a save waiting; it would write their file back as ours.
            this.cancelSave(drawing);
            state.applyDocument(conflict);
            return;
        }
        state.setRev(conflict.rev);
        state.setDirty(true);
        await this.flushOne(drawing);
    }

    /* Lets go of the machine: no more events, and no timer that would write to a daemon the client left. */
    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        for (const drawing of this.open.values()) {
            this.cancelSave(drawing);
        }
    }

    /* The drawing views the grid has on screen, which is exactly what the daemon should hold open. */
    private wantedIn(state: ReturnType<DocumentAccess['getState']>): string[] {
        const onScreen = state.layout === null ? [] : viewIdsIn(state.layout);
        return onScreen.filter((viewId) => state.views.some((view) => view.id === viewId && isDrawingView(view)));
    }

    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        const gone = [...this.open.keys()].some((viewId) => !state.views.some((view) => view.id === viewId && isDrawingView(view)));
        const wanted = this.wantedIn(state);
        // The ids rather than the layout itself: a project read again from disk is a new layout
        // object holding the same views, and that is a reconnect, not a change to the grid.
        const settled = wanted.length === this.open.size && wanted.every((viewId) => this.open.has(viewId));
        if (!settled || gone) {
            void this.sync(gone);
            return;
        }
        // The project was read again after the socket came back, so the daemon is ready to be
        // asked about these drawings: a restarted daemon knows no rev for one until it is opened.
        if (this.reconnecting && this.open.size > 0 && state.views !== previous.views) {
            this.reconnecting = false;
            void Promise.all([...this.open.values()].map((drawing) => this.reopen(drawing)));
        }
    }

    /*
     * A project arriving is what a reload looks like from here: the document store already holds
     * the view, so nothing else would ever ask for its drawing.
     */
    private onProject(state: ReturnType<ProjectAccess['getState']>, previous: ReturnType<ProjectAccess['getState']>): void {
        if (state.current?.projectId !== previous.current?.projectId || state.switching !== previous.switching) {
            void this.sync();
        }
    }

    private onStatus(status: TransportStatus): void {
        if (status !== 'open') {
            this.reconnecting = true;
        }
    }

    /*
     * Brings the open drawings in step with the grid: every drawing view on screen is open, and
     * nothing else is. `dropped` says a view is gone from the project, in which case what it held
     * may not be written: the save would resurrect the file as an orphan.
     */
    private async sync(dropped = false): Promise<void> {
        const { current, switching } = this.projects.getState();
        // Between projects the views on screen and the project they belong to are not the same yet.
        if (switching) {
            return;
        }
        const state = this.documents.getState();
        const projectId = current?.projectId ?? null;
        const wanted = new Set(projectId === null ? [] : this.wantedIn(state));

        for (const drawing of [...this.open.values()]) {
            if (wanted.has(drawing.viewId) && drawing.projectId === projectId) {
                continue;
            }
            await this.close(drawing, dropped);
        }
        await Promise.all(
            [...wanted].filter((viewId) => !this.open.has(viewId)).map((viewId) => this.openOne(projectId!, viewId, state.viewLocal[viewId] ?? null))
        );
    }

    private async close(drawing: OpenDrawing, dropped: boolean): Promise<void> {
        if (dropped) {
            // The view is gone from the project; a save now would put the file back as an orphan.
            this.cancelSave(drawing);
        } else {
            await this.flushOne(drawing);
        }
        // Taken out first: emptying the editor is a change like any other, and `onDrawing` reads
        // this map to tell an edit from the drawing being taken off screen.
        this.open.delete(drawing.viewId);
        drawing.store.getState().unload();
        this.drawings.release(drawing.viewId);
        void this.transport.request('drawing.close', { projectId: drawing.projectId, viewId: drawing.viewId }).catch(() => undefined);
    }

    private async openOne(projectId: string, viewId: string, local: ProjectViewLocal | null): Promise<void> {
        const drawing: OpenDrawing = {
            projectId,
            viewId,
            store: this.drawings.of(viewId),
            saveTimer: null,
            saving: null,
            generation: 0,
            retriedRev: null
        };
        this.open.set(viewId, drawing);
        try {
            // A drawing made a moment ago is only in the file after the project save has landed.
            await this.flushProject();
            const { document } = await this.transport.request('drawing.open', { projectId, viewId });
            if (this.open.get(viewId) !== drawing) {
                return;
            }
            drawing.store.getState().load(viewId, document, local);
        } catch (e) {
            if (this.open.get(viewId) === drawing) {
                this.open.delete(viewId);
                this.report(drawing, e, i18next.t('drawing:error.drawingOpen'));
            }
        }
    }

    /*
     * Asks the daemon for one drawing again and picks up where the two sides differ: the same rev
     * means the screen is still the file and only the daemon had forgotten, a newer one is a
     * conflict while there is unsaved work and otherwise simply what the drawing is now.
     */
    private async reopen(drawing: OpenDrawing): Promise<void> {
        const generation = drawing.generation;
        let document: DrawingDocument;
        try {
            ({ document } = await this.transport.request('drawing.open', { projectId: drawing.projectId, viewId: drawing.viewId }));
        } catch (e) {
            this.report(drawing, e, i18next.t('drawing:error.drawingOpen'));
            return;
        }
        if (generation !== drawing.generation || this.open.get(drawing.viewId) !== drawing) {
            return;
        }
        const state = drawing.store.getState();
        if (document.rev === state.rev) {
            // The file is where the screen thinks it is, so the daemon only had to be told again.
            if (state.dirty && drawing.retriedRev !== document.rev) {
                drawing.retriedRev = document.rev;
                await this.save(drawing);
            }
            return;
        }
        if (state.dirty || drawing.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    private onDrawing(viewId: string, state: DrawingState, previous: DrawingState): void {
        const drawing = this.open.get(viewId);
        if (!drawing || state.loading || previous.loading) {
            return;
        }
        if (state.edits !== previous.edits) {
            state.setDirty(true);
            this.scheduleSave(drawing);
        }
    }

    private cancelSave(drawing: OpenDrawing): void {
        if (drawing.saveTimer) {
            clearTimeout(drawing.saveTimer);
            drawing.saveTimer = null;
        }
    }

    private scheduleSave(drawing: OpenDrawing): void {
        this.cancelSave(drawing);
        drawing.saveTimer = setTimeout(() => {
            drawing.saveTimer = null;
            void this.save(drawing);
        }, this.saveDelayMs);
    }

    private save(drawing: OpenDrawing): Promise<void> {
        if (drawing.saving) {
            // One write at a time per drawing; the edits made meanwhile ride the next one.
            return drawing.saving.then(() => (drawing.store.getState().dirty ? this.save(drawing) : undefined));
        }
        const state = drawing.store.getState();
        // A link that is down keeps the edit dirty for `resume` to write, rather than a request that can only fail.
        if (state.conflict || this.transport.status !== 'open') {
            return Promise.resolve();
        }
        state.setDirty(false);
        let stale = false;
        drawing.saving = this.transport
            .request('drawing.save', { projectId: drawing.projectId, viewId: drawing.viewId, baseRev: state.rev, content: state.exportContent() })
            .then((result) => {
                drawing.retriedRev = null;
                drawing.store.getState().setRev(result.rev);
                drawing.store.getState().setError(null);
            })
            .catch((e: unknown) => {
                drawing.store.getState().setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // Our own write never reaches the watcher, so the newer document has to be asked
                    // for: without this a daemon that forgot the drawing leaves the work unsaved.
                    stale = true;
                    return;
                }
                this.report(drawing, e, i18next.t('drawing:error.drawingSave'));
            })
            .finally(() => {
                drawing.saving = null;
                if (stale) {
                    void this.reopen(drawing);
                }
            });
        return drawing.saving;
    }

    private onChanged(projectId: string, viewId: string, document: DrawingDocument): void {
        const drawing = this.open.get(viewId);
        if (!drawing || drawing.projectId !== projectId) {
            return;
        }
        const state = drawing.store.getState();
        if (state.dirty || drawing.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    /* An error belongs to the drawing it happened to; one without a drawing has nowhere to go but
       the focused editor, which is the one whose banner a person is looking at. */
    private report(drawing: OpenDrawing | null, e: unknown, fallback: string): void {
        if (isConnectionError(e)) {
            return;
        }
        const store = drawing?.store ?? this.focused?.store ?? this.drawings.blank;
        store.getState().setError(e instanceof Error ? e.message : fallback);
    }
}
