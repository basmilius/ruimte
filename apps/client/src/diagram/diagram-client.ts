import {
    isDiagramView,
    type DiagramDocument,
    type ProjectLocal,
    type ProjectSummary,
    type ProjectView,
    type ProjectViewLocal,
    type SplitLayout
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import type { DiagramState } from '@/state/diagram';
import type { EditorRegistry } from '@/state/editors';
import { viewIdsIn } from '@/shell/split';

type DiagramStore = StoreApi<DiagramState>;

/* The slice of the document store this client reads; the real store has more. */
interface DocumentAccess {
    getState(): {
        views: ProjectView[];
        activeViewId: string | null;
        /* Which views the grid has on screen; every diagram among them is one the daemon holds open. */
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

interface DiagramClientOptions {
    saveDelayMs?: number;
    /* Writes the project file first, so the daemon knows the view before its diagram is asked for. */
    flushProject?: () => Promise<void>;
    /* Left out in tests, where there is no window to listen on. */
    window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
    document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/* One diagram the daemon has open for this client, with everything a save of that one file needs. */
interface OpenDiagram {
    projectId: string;
    viewId: string;
    store: DiagramStore;
    saveTimer: ReturnType<typeof setTimeout> | null;
    saving: Promise<void> | null;
    /* Rises on every open, so a document that arrives late never lands on the diagram after it. */
    generation: number;
    /* The rev a refused save was already tried again on, so a refusal never turns into a circle. */
    retriedRev: number | null;
}

/*
 * Keeps the diagram on screen and its file in step, the way `ProjectClient` does for the project.
 * It follows the active view: a diagram coming up is opened and loaded, one going away is written
 * out first. Edits save after a short pause, one write at a time, always against the rev that was
 * loaded; a file that moved on in the meantime goes to the banner.
 */
export class DiagramClient {
    private readonly transport: Transport;
    /*
     * The diagram editors of this workspace. The client is what opens and closes one: a diagram is a
     * file of its own with a rev of its own, so its editor lives exactly as long as the daemon holds
     * it open, which is not the same span as the view being in the grid.
     */
    private readonly diagrams: EditorRegistry<DiagramState>;
    private readonly documents: DocumentAccess;
    private readonly projects: ProjectAccess;
    private readonly saveDelayMs: number;
    private readonly flushProject: () => Promise<void>;
    private readonly unsubscribe: Array<() => void> = [];
    /* Every diagram on screen, by view id. The grid can hold more than one at a time, and each is a
       file of its own with a rev of its own, so everything a save needs is kept per diagram. */
    private readonly open = new Map<string, OpenDiagram>();
    /* The socket went away, so the daemon may have forgotten these diagrams while it was gone. */
    private reconnecting = false;

    constructor(
        transport: Transport,
        diagrams: EditorRegistry<DiagramState>,
        documents: DocumentAccess,
        projects: ProjectAccess,
        options: DiagramClientOptions = {}
    ) {
        this.transport = transport;
        this.diagrams = diagrams;
        this.documents = documents;
        this.projects = projects;
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.flushProject = options.flushProject ?? (() => Promise.resolve());
        this.unsubscribe.push(
            transport.on('diagram.changed', ({ projectId, viewId, document }) => this.onChanged(projectId, viewId, document)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
            projects.subscribe((state, previous) => this.onProject(state, previous)),
            diagrams.subscribe((viewId, state, previous) => this.onDiagram(viewId, state, previous))
        );
        const host = options.window === undefined ? (typeof window === 'undefined' ? null : window) : options.window;
        if (host) {
            // A window closed right after an edit is worth a best-effort send.
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

    /* The diagram of the cell that has the focus, which is the one a banner or a menu is about. */
    private get focused(): OpenDiagram | null {
        const { activeViewId } = this.documents.getState();
        return activeViewId === null ? null : (this.open.get(activeViewId) ?? null);
    }

    /* Writes pending edits now; used before a view switch, a project switch and on the way out. */
    async flush(): Promise<void> {
        await Promise.all([...this.open.values()].map((diagram) => this.flushOne(diagram)));
    }

    private async flushOne(diagram: OpenDiagram): Promise<void> {
        this.cancelSave(diagram);
        if (diagram.store.getState().dirty) {
            await this.save(diagram);
        } else if (diagram.saving) {
            await diagram.saving;
        }
    }

    /*
     * The link came back while the project stayed on screen. The daemon may have forgotten every
     * diagram while it was gone, and an edit made meanwhile is still waiting to be written.
     */
    async resume(): Promise<void> {
        if (!this.reconnecting) {
            return;
        }
        this.reconnecting = false;
        await Promise.all([...this.open.values()].map((diagram) => this.reopen(diagram)));
    }

    /* Copies the graph of one diagram view into another, which is what duplicating a view is. */
    async copy(from: string, to: string): Promise<void> {
        const projectId = this.projects.getState().current?.projectId;
        if (!projectId) {
            return;
        }
        await this.flush();
        await this.flushProject();
        await this.transport.request('diagram.copy', { projectId, from, to }).catch((e: unknown) => this.report(null, e, 'The diagram could not be copied'));
    }

    /* Takes what is on disk, or keeps the screen and writes it over the file's newer rev. */
    async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
        // The banner stands in one cell, so the answer is about the diagram in the cell with the focus.
        const diagram = this.focused ?? [...this.open.values()].find((each) => each.store.getState().conflict !== null) ?? null;
        const state = diagram?.store.getState();
        const conflict = state?.conflict;
        if (!diagram || !state || !conflict) {
            return;
        }
        state.setConflict(null);
        if (choice === 'theirs') {
            // The edit that caused the conflict still has a save waiting; it would write their file back as ours.
            this.cancelSave(diagram);
            state.applyDocument(conflict);
            return;
        }
        state.setRev(conflict.rev);
        state.setDirty(true);
        await this.flushOne(diagram);
    }

    /* Lets go of the machine: no more events, and no timer that would write to a daemon the client left. */
    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        for (const diagram of this.open.values()) {
            this.cancelSave(diagram);
        }
    }

    /* The diagram views the grid has on screen, which is exactly what the daemon should hold open. */
    private wantedIn(state: ReturnType<DocumentAccess['getState']>): string[] {
        const onScreen = state.layout === null ? [] : viewIdsIn(state.layout);
        return onScreen.filter((viewId) => state.views.some((view) => view.id === viewId && isDiagramView(view)));
    }

    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        const gone = [...this.open.keys()].some((viewId) => !state.views.some((view) => view.id === viewId && isDiagramView(view)));
        const wanted = this.wantedIn(state);
        // The ids rather than the layout itself: a project read again from disk is a new layout
        // object holding the same views, and that is a reconnect, not a change to the grid.
        const settled = wanted.length === this.open.size && wanted.every((viewId) => this.open.has(viewId));
        if (!settled || gone) {
            void this.sync(gone);
            return;
        }
        // The project was read again after the socket came back, so the daemon is ready to be
        // asked about these diagrams: a restarted daemon knows no rev for one until it is opened.
        if (this.reconnecting && this.open.size > 0 && state.views !== previous.views) {
            this.reconnecting = false;
            void Promise.all([...this.open.values()].map((diagram) => this.reopen(diagram)));
        }
    }

    /*
     * A project arriving is what a reload looks like from here: the document store already holds
     * the view, so nothing else would ever ask for its diagram.
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
     * Brings the open diagrams in step with the grid: every diagram view on screen is open, and
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

        for (const diagram of [...this.open.values()]) {
            if (wanted.has(diagram.viewId) && diagram.projectId === projectId) {
                continue;
            }
            await this.close(diagram, dropped);
        }
        await Promise.all(
            [...wanted].filter((viewId) => !this.open.has(viewId)).map((viewId) => this.openOne(projectId!, viewId, state.viewLocal[viewId] ?? null))
        );
    }

    private async close(diagram: OpenDiagram, dropped: boolean): Promise<void> {
        if (dropped) {
            // The view is gone from the project; a save now would put the file back as an orphan.
            this.cancelSave(diagram);
        } else {
            await this.flushOne(diagram);
        }
        // Taken out first: emptying the editor is a change like any other, and `onDiagram` reads
        // this map to tell an edit from the diagram being taken off screen.
        this.open.delete(diagram.viewId);
        diagram.store.getState().unload();
        this.diagrams.release(diagram.viewId);
        void this.transport.request('diagram.close', { projectId: diagram.projectId, viewId: diagram.viewId }).catch(() => undefined);
    }

    private async openOne(projectId: string, viewId: string, local: ProjectViewLocal | null): Promise<void> {
        const diagram: OpenDiagram = {
            projectId,
            viewId,
            store: this.diagrams.of(viewId),
            saveTimer: null,
            saving: null,
            generation: 0,
            retriedRev: null
        };
        this.open.set(viewId, diagram);
        try {
            // A diagram made a moment ago is only in the file after the project save has landed.
            await this.flushProject();
            const { document } = await this.transport.request('diagram.open', { projectId, viewId });
            if (this.open.get(viewId) !== diagram) {
                return;
            }
            diagram.store.getState().load(viewId, document, local);
        } catch (e) {
            if (this.open.get(viewId) === diagram) {
                this.open.delete(viewId);
                this.report(diagram, e, 'The diagram could not be opened');
            }
        }
    }

    /*
     * Asks the daemon for one diagram again and picks up where the two sides differ: the same rev
     * means the screen is still the file and only the daemon had forgotten, a newer one is a
     * conflict while there is unsaved work and otherwise simply what the diagram is now.
     */
    private async reopen(diagram: OpenDiagram): Promise<void> {
        const generation = diagram.generation;
        let document: DiagramDocument;
        try {
            ({ document } = await this.transport.request('diagram.open', { projectId: diagram.projectId, viewId: diagram.viewId }));
        } catch (e) {
            this.report(diagram, e, 'The diagram could not be opened');
            return;
        }
        if (generation !== diagram.generation || this.open.get(diagram.viewId) !== diagram) {
            return;
        }
        const state = diagram.store.getState();
        if (document.rev === state.rev) {
            // The file is where the screen thinks it is, so the daemon only had to be told again.
            if (state.dirty && diagram.retriedRev !== document.rev) {
                diagram.retriedRev = document.rev;
                await this.save(diagram);
            }
            return;
        }
        if (state.dirty || diagram.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    private onDiagram(viewId: string, state: DiagramState, previous: DiagramState): void {
        const diagram = this.open.get(viewId);
        if (!diagram || state.loading || previous.loading) {
            return;
        }
        if (state.edits !== previous.edits) {
            state.setDirty(true);
            this.scheduleSave(diagram);
        }
    }

    private cancelSave(diagram: OpenDiagram): void {
        if (diagram.saveTimer) {
            clearTimeout(diagram.saveTimer);
            diagram.saveTimer = null;
        }
    }

    private scheduleSave(diagram: OpenDiagram): void {
        this.cancelSave(diagram);
        diagram.saveTimer = setTimeout(() => {
            diagram.saveTimer = null;
            void this.save(diagram);
        }, this.saveDelayMs);
    }

    private save(diagram: OpenDiagram): Promise<void> {
        if (diagram.saving) {
            // One write at a time per diagram; the edits made meanwhile ride the next one.
            return diagram.saving.then(() => (diagram.store.getState().dirty ? this.save(diagram) : undefined));
        }
        const state = diagram.store.getState();
        // A link that is down keeps the edit dirty for `resume` to write, rather than a request that can only fail.
        if (state.conflict || this.transport.status !== 'open') {
            return Promise.resolve();
        }
        state.setDirty(false);
        let stale = false;
        diagram.saving = this.transport
            .request('diagram.save', { projectId: diagram.projectId, viewId: diagram.viewId, baseRev: state.rev, content: state.exportContent() })
            .then((result) => {
                diagram.retriedRev = null;
                diagram.store.getState().setRev(result.rev);
                diagram.store.getState().setError(null);
            })
            .catch((e: unknown) => {
                diagram.store.getState().setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // Our own write never reaches the watcher, so the newer document has to be asked
                    // for: without this a daemon that forgot the diagram leaves the work unsaved.
                    stale = true;
                    return;
                }
                this.report(diagram, e, 'The diagram could not be saved');
            })
            .finally(() => {
                diagram.saving = null;
                if (stale) {
                    void this.reopen(diagram);
                }
            });
        return diagram.saving;
    }

    private onChanged(projectId: string, viewId: string, document: DiagramDocument): void {
        const diagram = this.open.get(viewId);
        if (!diagram || diagram.projectId !== projectId) {
            return;
        }
        const state = diagram.store.getState();
        if (state.dirty || diagram.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    /* An error belongs to the diagram it happened to; one without a diagram has nowhere to go but
       the focused editor, which is the one whose banner a person is looking at. */
    private report(diagram: OpenDiagram | null, e: unknown, fallback: string): void {
        if (isConnectionError(e)) {
            return;
        }
        const store = diagram?.store ?? this.focused?.store ?? this.diagrams.blank;
        store.getState().setError(e instanceof Error ? e.message : fallback);
    }
}
