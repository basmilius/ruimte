import { isDrawingView, type DrawingDocument, type ProjectLocal, type ProjectSummary, type ProjectView, type ProjectViewLocal } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import type { useDrawing } from '@/state/drawing';

type DrawingStore = StoreApi<ReturnType<typeof useDrawing.getState>>;

/* The slice of the document store this client reads; the real store has more. */
interface DocumentAccess {
    getState(): {
        views: ProjectView[];
        activeViewId: string | null;
        viewLocal: Record<string, ProjectViewLocal>;
        loading: boolean;
        exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views'>;
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

/*
 * Keeps the drawing on screen and its file in step, the way `ProjectClient` does for the project.
 * It follows the active view: a drawing coming up is opened and loaded, one going away is written
 * out first. Edits save after a short pause, one write at a time, always against the rev that was
 * loaded; a file that moved on in the meantime goes to the banner.
 */
export class DrawingClient {
    private readonly transport: Transport;
    private readonly drawing: DrawingStore;
    private readonly documents: DocumentAccess;
    private readonly projects: ProjectAccess;
    private readonly saveDelayMs: number;
    private readonly flushProject: () => Promise<void>;
    private readonly unsubscribe: Array<() => void> = [];
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private saving: Promise<void> | null = null;
    /* Which drawing is loaded, and under which project, so a save can never land in another one. */
    private open: { projectId: string; viewId: string } | null = null;
    /* Rises on every open, so a document that arrives late never lands on the drawing after it. */
    private generation = 0;
    /* The socket went away, so the daemon may have forgotten this drawing while it was gone. */
    private reconnecting = false;
    /* The rev a refused save was already tried again on, so a refusal never turns into a circle. */
    private retriedRev: number | null = null;

    constructor(transport: Transport, drawing: DrawingStore, documents: DocumentAccess, projects: ProjectAccess, options: DrawingClientOptions = {}) {
        this.transport = transport;
        this.drawing = drawing;
        this.documents = documents;
        this.projects = projects;
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.flushProject = options.flushProject ?? (() => Promise.resolve());
        this.unsubscribe.push(
            transport.on('drawing.changed', ({ projectId, viewId, document }) => this.onChanged(projectId, viewId, document)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
            projects.subscribe((state, previous) => this.onProject(state, previous)),
            drawing.subscribe((state, previous) => this.onDrawing(state, previous))
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

    /* Writes pending edits now; used before a view switch, a project switch and on the way out. */
    async flush(): Promise<void> {
        this.cancelSave();
        if (this.drawing.getState().dirty) {
            await this.save();
        } else if (this.saving) {
            await this.saving;
        }
    }

    /* Copies the elements of one drawing view into another, which is what duplicating a view is. */
    async copy(from: string, to: string): Promise<void> {
        const projectId = this.projects.getState().current?.projectId;
        if (!projectId) {
            return;
        }
        await this.flush();
        await this.flushProject();
        await this.transport.request('drawing.copy', { projectId, from, to }).catch((e: unknown) => this.report(e, 'The drawing could not be copied'));
    }

    /* Takes what is on disk, or keeps the screen and writes it over the file's newer rev. */
    async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
        const state = this.drawing.getState();
        const conflict = state.conflict;
        if (!conflict) {
            return;
        }
        state.setConflict(null);
        if (choice === 'theirs') {
            state.applyDocument(conflict);
            return;
        }
        state.setRev(conflict.rev);
        state.setDirty(true);
        await this.flush();
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
    }

    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        const gone = this.open !== null && !state.views.some((view) => view.id === this.open!.viewId && isDrawingView(view));
        if (state.activeViewId !== previous.activeViewId || gone) {
            void this.sync(gone);
            return;
        }
        // The project was read again after the socket came back, so the daemon is ready to be
        // asked about this drawing: a restarted daemon knows no rev for it until it is opened.
        if (this.reconnecting && this.open && state.views !== previous.views) {
            this.reconnecting = false;
            void this.reopen();
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
     * Asks the daemon for this drawing again and picks up where the two sides differ: the same rev
     * means the screen is still the file and only the daemon had forgotten, a newer one is a
     * conflict while there is unsaved work and otherwise simply what the drawing is now.
     */
    private async reopen(): Promise<void> {
        const open = this.open;
        if (!open) {
            return;
        }
        const generation = this.generation;
        let document: DrawingDocument;
        try {
            ({ document } = await this.transport.request('drawing.open', open));
        } catch (e) {
            this.report(e, 'The drawing could not be opened');
            return;
        }
        if (generation !== this.generation || this.open !== open) {
            return;
        }
        const state = this.drawing.getState();
        if (document.rev === state.rev) {
            // The file is where the screen thinks it is, so the daemon only had to be told again.
            if (state.dirty && this.retriedRev !== document.rev) {
                this.retriedRev = document.rev;
                await this.save();
            }
            return;
        }
        if (state.dirty || this.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    private onDrawing(state: ReturnType<DrawingStore['getState']>, previous: ReturnType<DrawingStore['getState']>): void {
        if (state.loading || previous.loading || !this.open) {
            return;
        }
        if (state.edits !== previous.edits) {
            state.setDirty(true);
            this.scheduleSave();
        }
    }

    /*
     * Brings the store in step with the active view. `dropped` says the view is gone from the
     * project, in which case nothing may be written: the save would resurrect the file as an orphan.
     */
    private async sync(dropped = false): Promise<void> {
        const { current, switching } = this.projects.getState();
        // Between projects the views on screen and the project they belong to are not the same yet.
        if (switching) {
            return;
        }
        const { views, activeViewId, viewLocal } = this.documents.getState();
        const projectId = current?.projectId ?? null;
        const active = views.find((view) => view.id === activeViewId) ?? null;
        const wanted = active && isDrawingView(active) ? active.id : null;
        if (this.open && this.open.viewId === wanted && this.open.projectId === projectId) {
            return;
        }
        if (this.open) {
            const leaving = this.open;
            if (dropped) {
                // The view is gone from the project; a save now would put the file back as an orphan.
                this.cancelSave();
            } else {
                await this.flush();
            }
            this.open = null;
            this.drawing.getState().unload();
            void this.transport.request('drawing.close', leaving).catch(() => undefined);
        }
        if (!wanted || !projectId) {
            return;
        }
        const generation = ++this.generation;
        try {
            // A drawing made a moment ago is only in the file after the project save has landed.
            await this.flushProject();
            const { document } = await this.transport.request('drawing.open', { projectId, viewId: wanted });
            if (generation !== this.generation) {
                return;
            }
            this.open = { projectId, viewId: wanted };
            this.drawing.getState().load(wanted, document, viewLocal[wanted] ?? null);
        } catch (e) {
            if (generation === this.generation) {
                this.report(e, 'The drawing could not be opened');
            }
        }
    }

    private cancelSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
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

    private save(): Promise<void> {
        if (this.saving) {
            // One write at a time; the edits made meanwhile ride the next one.
            return this.saving.then(() => (this.drawing.getState().dirty ? this.save() : undefined));
        }
        const state = this.drawing.getState();
        const open = this.open;
        if (!open || state.conflict) {
            return Promise.resolve();
        }
        state.setDirty(false);
        let stale = false;
        this.saving = this.transport
            .request('drawing.save', { ...open, baseRev: state.rev, content: state.exportContent() })
            .then((result) => {
                this.retriedRev = null;
                this.drawing.getState().setRev(result.rev);
                this.drawing.getState().setError(null);
            })
            .catch((e: unknown) => {
                this.drawing.getState().setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // Our own write never reaches the watcher, so the newer document has to be asked
                    // for: without this a daemon that forgot the drawing leaves the work unsaved.
                    stale = true;
                    return;
                }
                this.report(e, 'The drawing could not be saved');
            })
            .finally(() => {
                this.saving = null;
                if (stale) {
                    void this.reopen();
                }
            });
        return this.saving;
    }

    private onChanged(projectId: string, viewId: string, document: DrawingDocument): void {
        if (!this.open || this.open.projectId !== projectId || this.open.viewId !== viewId) {
            return;
        }
        const state = this.drawing.getState();
        if (state.dirty || this.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    private report(e: unknown, fallback: string): void {
        if (isConnectionError(e)) {
            return;
        }
        this.drawing.getState().setError(e instanceof Error ? e.message : fallback);
    }
}
