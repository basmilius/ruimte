import type { ProjectLocal, ProjectSummary, ProjectView, ProjectViewLocal, SplitLayout } from '@ruimte/contracts';
import i18next from 'i18next';
import type { StoreApi } from 'zustand';
import { viewIdsIn } from '@/shell/split';
import type { EditorRegistry } from '@/state/editors';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';

/* The slice of the document store this client reads; the real store has more. */
export interface DocumentAccess {
    getState(): {
        views: ProjectView[];
        activeViewId: string | null;
        /* Which views the grid has on screen; every file view among them is one the daemon holds open. */
        layout: SplitLayout | null;
        viewLocal: Record<string, ProjectViewLocal>;
        loading: boolean;
        /* Deleted views that can still come back; the file keeps them, so what they hold is still worth a save. */
        trashed: ReadonlyArray<{ view: ProjectView }>;
        exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views' | 'layout'>;
    };
    subscribe: StoreApi<DocumentAccess extends { getState(): infer S } ? S : never>['subscribe'];
}

export interface ProjectAccess {
    getState(): { current: ProjectSummary | null; switching: boolean };
    subscribe: StoreApi<ProjectAccess extends { getState(): infer S } ? S : never>['subscribe'];
}

/* What an editor of a file-backed view offers this client, whatever kind of file it holds. */
export interface FileEditorState<TDocument, TContent> {
    rev: number;
    dirty: boolean;
    /* Counts changes to the content, which is what this client saves on. */
    edits: number;
    loading: boolean;
    conflict: TDocument | null;

    load(viewId: string, document: TDocument, local: ProjectViewLocal | null): void;
    unload(): void;
    exportContent(): TContent;
    setRev(rev: number): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: TDocument | null): void;
    setError(error: string | null): void;
    applyDocument(document: TDocument): void;
}

/*
 * One kind of file on the wire. The request names stay here rather than being built from a word:
 * `REQUEST_SCHEMAS` types every payload and every result on its own, and a call that took the name
 * as an argument could satisfy that table only by casting past it.
 */
export interface FileEditorChannel<TDocument, TContent> {
    isView(view: ProjectView): boolean;
    onChanged(transport: Transport, listener: (projectId: string, viewId: string, document: TDocument) => void): () => void;
    open(transport: Transport, projectId: string, viewId: string): Promise<TDocument>;
    save(transport: Transport, projectId: string, viewId: string, baseRev: number, content: TContent): Promise<number>;
    close(transport: Transport, projectId: string, viewId: string): Promise<unknown>;
    copy(transport: Transport, projectId: string, from: string, to: string): Promise<unknown>;
    /*
     * The keys of what a person reads when one of the three fails and the error itself says nothing
     * useful. Keys rather than words: they are read at the moment it fails, so a language a person
     * changed lands on the next error instead of on the next reload.
     */
    errors: { open: string; save: string; copy: string };
}

export interface FileEditorClientOptions {
    saveDelayMs?: number;
    /* Writes the project file first, so the daemon knows the view before its file is asked for. */
    flushProject?: () => Promise<void>;
    /* Left out in tests, where there is no window to listen on. */
    window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
    document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/* One file the daemon has open for this client, with everything a save of that one file needs. */
interface OpenFile<TState> {
    projectId: string;
    viewId: string;
    store: StoreApi<TState>;
    saveTimer: ReturnType<typeof setTimeout> | null;
    saving: Promise<void> | null;
    /* Rises on every open, so a document that arrives late never lands on the editor after it. */
    generation: number;
    /* The rev a refused save was already tried again on, so a refusal never turns into a circle. */
    retriedRev: number | null;
}

/*
 * Keeps a file view on screen and its file in step, the way `ProjectClient` does for the project.
 * It follows the grid: a view coming up is opened and loaded, one going away is written out first.
 * Edits save after a short pause, one write at a time, always against the rev that was loaded; a
 * file that moved on in the meantime goes to the banner.
 */
export class FileEditorClient<TState extends FileEditorState<TDocument, TContent>, TDocument extends { rev: number }, TContent> {
    private readonly transport: Transport;
    /*
     * The editors of this workspace. The client is what opens and closes one: a view of this kind is
     * a file of its own with a rev of its own, so its editor lives exactly as long as the daemon
     * holds it open, which is not the same span as the view being in the grid.
     */
    private readonly editors: EditorRegistry<TState>;
    private readonly documents: DocumentAccess;
    private readonly projects: ProjectAccess;
    private readonly channel: FileEditorChannel<TDocument, TContent>;
    private readonly saveDelayMs: number;
    private readonly flushProject: () => Promise<void>;
    private readonly unsubscribe: Array<() => void> = [];
    /* Every file on screen, by view id. The grid can hold more than one at a time, and each is a
       file of its own with a rev of its own, so everything a save needs is kept per file. */
    private readonly open = new Map<string, OpenFile<TState>>();
    /* The socket went away, so the daemon may have forgotten these files while it was gone. */
    private reconnecting = false;

    constructor(
        transport: Transport,
        editors: EditorRegistry<TState>,
        documents: DocumentAccess,
        projects: ProjectAccess,
        channel: FileEditorChannel<TDocument, TContent>,
        options: FileEditorClientOptions = {}
    ) {
        this.transport = transport;
        this.editors = editors;
        this.documents = documents;
        this.projects = projects;
        this.channel = channel;
        this.saveDelayMs = options.saveDelayMs ?? 400;
        this.flushProject = options.flushProject ?? (() => Promise.resolve());
        this.unsubscribe.push(
            channel.onChanged(transport, (projectId, viewId, document) => this.onChanged(projectId, viewId, document)),
            transport.subscribeStatus((status) => this.onStatus(status)),
            documents.subscribe((state, previous) => this.onDocument(state, previous)),
            projects.subscribe((state, previous) => this.onProject(state, previous)),
            editors.subscribe((viewId, state, previous) => this.onEditor(viewId, state, previous))
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

    /* The file of the cell that has the focus, which is the one a banner or a menu is about. */
    private get focused(): OpenFile<TState> | null {
        const { activeViewId } = this.documents.getState();
        return activeViewId === null ? null : (this.open.get(activeViewId) ?? null);
    }

    /* Writes pending edits now; used before a view switch, a project switch and on the way out. */
    async flush(): Promise<void> {
        await Promise.all([...this.open.values()].map((file) => this.flushOne(file)));
    }

    /*
     * The link came back while the project stayed on screen. The daemon may have forgotten every
     * file while it was gone, and an edit made meanwhile is still waiting to be written.
     */
    async resume(): Promise<void> {
        if (!this.reconnecting) {
            return;
        }
        this.reconnecting = false;
        await Promise.all([...this.open.values()].map((file) => this.reopen(file)));
    }

    /* Copies the content of one view into another, which is what duplicating a view is. */
    async copy(from: string, to: string): Promise<void> {
        const projectId = this.projects.getState().current?.projectId;
        if (!projectId) {
            return;
        }
        await this.flush();
        await this.flushProject();
        await this.channel.copy(this.transport, projectId, from, to).catch((e: unknown) => this.report(null, e, this.channel.errors.copy));
    }

    /* Takes what is on disk, or keeps the screen and writes it over the file's newer rev. */
    async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
        // The banner stands in one cell, so the answer is about the file in the cell with the focus.
        const file = this.focused ?? [...this.open.values()].find((each) => each.store.getState().conflict !== null) ?? null;
        const state = file?.store.getState();
        const conflict = state?.conflict;
        if (!file || !state || !conflict) {
            return;
        }
        state.setConflict(null);
        if (choice === 'theirs') {
            // The edit that caused the conflict still has a save waiting; it would write their file back as ours.
            this.cancelSave(file);
            state.applyDocument(conflict);
            return;
        }
        state.setRev(conflict.rev);
        state.setDirty(true);
        await this.flushOne(file);
    }

    /* Lets go of the machine: no more events, and no timer that would write to a daemon the client left. */
    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        for (const file of this.open.values()) {
            this.cancelSave(file);
        }
    }

    private async flushOne(file: OpenFile<TState>): Promise<void> {
        this.cancelSave(file);
        if (file.store.getState().dirty) {
            await this.save(file);
        } else if (file.saving) {
            await file.saving;
        }
    }

    /* The views of this kind the grid has on screen, which is exactly what the daemon should hold open. */
    private wantedIn(state: ReturnType<DocumentAccess['getState']>): string[] {
        const onScreen = state.layout === null ? [] : viewIdsIn(state.layout);
        return onScreen.filter((viewId) => state.views.some((view) => view.id === viewId && this.channel.isView(view)));
    }

    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        const held = [...state.views, ...state.trashed.map((entry) => entry.view)];
        const gone = [...this.open.keys()].some((viewId) => !held.some((view) => view.id === viewId && this.channel.isView(view)));
        const wanted = this.wantedIn(state);
        // The ids rather than the layout itself, since a project read again from disk is a new layout
        // object holding the same views, and that is a reconnect, not a change to the grid.
        const settled = wanted.length === this.open.size && wanted.every((viewId) => this.open.has(viewId));
        if (!settled || gone) {
            void this.sync(gone);
            return;
        }
        // The project was read again after the socket came back, so the daemon is ready to be asked
        // about these files, since a restarted daemon knows no rev for one until it is opened.
        if (this.reconnecting && this.open.size > 0 && state.views !== previous.views) {
            this.reconnecting = false;
            void Promise.all([...this.open.values()].map((file) => this.reopen(file)));
        }
    }

    /*
     * A project arriving is what a reload looks like from here, since the document store already holds
     * the view, so nothing else would ever ask for its file.
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
     * Brings the open files in step with the grid: every view of this kind on screen is open, and
     * nothing else is. `dropped` says a view is gone from the project, in which case what it held
     * may not be written, since the save would resurrect the file as an orphan.
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

        for (const file of [...this.open.values()]) {
            if (wanted.has(file.viewId) && file.projectId === projectId) {
                continue;
            }
            await this.close(file, dropped);
        }
        await Promise.all(
            [...wanted].filter((viewId) => !this.open.has(viewId)).map((viewId) => this.openOne(projectId!, viewId, state.viewLocal[viewId] ?? null))
        );
    }

    private async close(file: OpenFile<TState>, dropped: boolean): Promise<void> {
        if (dropped) {
            // The view is gone from the project; a save now would put the file back as an orphan.
            this.cancelSave(file);
        } else {
            await this.flushOne(file);
        }
        // Taken out first, since emptying the editor is a change like any other, and `onEditor` reads
        // this map to tell an edit from the view being taken off screen.
        this.open.delete(file.viewId);
        file.store.getState().unload();
        this.editors.release(file.viewId);
        void this.channel.close(this.transport, file.projectId, file.viewId).catch(() => undefined);
    }

    private async openOne(projectId: string, viewId: string, local: ProjectViewLocal | null): Promise<void> {
        const file: OpenFile<TState> = {
            projectId,
            viewId,
            store: this.editors.of(viewId),
            saveTimer: null,
            saving: null,
            generation: 0,
            retriedRev: null
        };
        this.open.set(viewId, file);
        try {
            // A view made a moment ago is only in the file after the project save has landed.
            await this.flushProject();
            const document = await this.channel.open(this.transport, projectId, viewId);
            if (this.open.get(viewId) !== file) {
                return;
            }
            file.store.getState().load(viewId, document, local);
        } catch (e) {
            if (this.open.get(viewId) === file) {
                this.open.delete(viewId);
                this.report(file, e, this.channel.errors.open);
            }
        }
    }

    /*
     * Asks the daemon for one file again and picks up where the two sides differ: the same rev means
     * the screen is still the file and only the daemon had forgotten, a newer one is a conflict
     * while there is unsaved work and otherwise simply what the file is now.
     */
    private async reopen(file: OpenFile<TState>): Promise<void> {
        const generation = file.generation;
        let document: TDocument;
        try {
            document = await this.channel.open(this.transport, file.projectId, file.viewId);
        } catch (e) {
            this.report(file, e, this.channel.errors.open);
            return;
        }
        if (generation !== file.generation || this.open.get(file.viewId) !== file) {
            return;
        }
        const state = file.store.getState();
        if (document.rev === state.rev) {
            // The file is where the screen thinks it is, so the daemon only had to be told again.
            if (state.dirty && file.retriedRev !== document.rev) {
                file.retriedRev = document.rev;
                await this.save(file);
            }
            return;
        }
        if (state.dirty || file.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    private onEditor(viewId: string, state: TState, previous: TState): void {
        const file = this.open.get(viewId);
        if (!file || state.loading || previous.loading) {
            return;
        }
        if (state.edits !== previous.edits) {
            state.setDirty(true);
            this.scheduleSave(file);
        }
    }

    private cancelSave(file: OpenFile<TState>): void {
        if (file.saveTimer) {
            clearTimeout(file.saveTimer);
            file.saveTimer = null;
        }
    }

    private scheduleSave(file: OpenFile<TState>): void {
        this.cancelSave(file);
        file.saveTimer = setTimeout(() => {
            file.saveTimer = null;
            void this.save(file);
        }, this.saveDelayMs);
    }

    private save(file: OpenFile<TState>): Promise<void> {
        if (file.saving) {
            // One write at a time per file; the edits made meanwhile ride the next one.
            return file.saving.then(() => (file.store.getState().dirty ? this.save(file) : undefined));
        }
        const state = file.store.getState();
        // A link that is down keeps the edit dirty for `resume` to write, rather than a request that can only fail.
        if (state.conflict || this.transport.status !== 'open') {
            return Promise.resolve();
        }
        state.setDirty(false);
        let stale = false;
        file.saving = this.channel
            .save(this.transport, file.projectId, file.viewId, state.rev, state.exportContent())
            .then((rev) => {
                file.retriedRev = null;
                file.store.getState().setRev(rev);
                file.store.getState().setError(null);
            })
            .catch((e: unknown) => {
                file.store.getState().setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // Our own write never reaches the watcher, so the newer document has to be asked
                    // for, since without this a daemon that forgot the file leaves the work unsaved.
                    stale = true;
                    return;
                }
                this.report(file, e, this.channel.errors.save);
            })
            .finally(() => {
                file.saving = null;
                if (stale) {
                    void this.reopen(file);
                }
            });
        return file.saving;
    }

    private onChanged(projectId: string, viewId: string, document: TDocument): void {
        const file = this.open.get(viewId);
        if (!file || file.projectId !== projectId) {
            return;
        }
        const state = file.store.getState();
        if (state.dirty || file.saving) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(document);
    }

    /* An error belongs to the file it happened to; one without a file has nowhere to go but the
       focused editor, which is the one whose banner a person is looking at. */
    private report(file: OpenFile<TState> | null, e: unknown, fallbackKey: string): void {
        if (isConnectionError(e)) {
            return;
        }
        const store = file?.store ?? this.focused?.store ?? this.editors.blank;
        store.getState().setError(e instanceof Error ? e.message : i18next.t(fallbackKey));
    }
}
