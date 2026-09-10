import { isDrawingView, type DrawingDocument, type ProjectLocal, type ProjectSummary, type ProjectView, type ProjectViewLocal } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { TransportError, type Transport } from '@/transport/transport';
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
    getState(): { current: ProjectSummary | null };
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

    constructor(transport: Transport, drawing: DrawingStore, documents: DocumentAccess, projects: ProjectAccess, options: DrawingClientOptions = {}) {
        this.transport = transport;
        this.drawing = drawing;
        this.documents = documents;
        this.projects = projects;
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.flushProject = options.flushProject ?? (() => Promise.resolve());
        this.unsubscribe.push(
            transport.on('drawing.changed', ({ projectId, viewId, document }) => this.onChanged(projectId, viewId, document)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
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

    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
    }

    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        const gone = this.open !== null && !state.views.some((view) => view.id === this.open!.viewId && isDrawingView(view));
        if (state.activeViewId !== previous.activeViewId || gone) {
            void this.sync(gone);
        }
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
        const { views, activeViewId, viewLocal } = this.documents.getState();
        const active = views.find((view) => view.id === activeViewId) ?? null;
        const wanted = active && isDrawingView(active) ? active.id : null;
        if (this.open && this.open.viewId === wanted) {
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
        if (!wanted) {
            return;
        }
        const projectId = this.projects.getState().current?.projectId;
        if (!projectId) {
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
        this.saving = this.transport
            .request('drawing.save', { ...open, baseRev: state.rev, content: state.exportContent() })
            .then((result) => {
                this.drawing.getState().setRev(result.rev);
                this.drawing.getState().setError(null);
            })
            .catch((e: unknown) => {
                this.drawing.getState().setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // The watcher's event carries the newer document; nothing to do until it arrives.
                    return;
                }
                this.report(e, 'The drawing could not be saved');
            })
            .finally(() => {
                this.saving = null;
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
