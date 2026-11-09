import { messageOf } from '@adecore/ui';
import type { ProjectLocal, ProjectSummary, ProjectView, ProjectViewLocal, SplitLayout } from '@ruimte/contracts';
import i18next from 'i18next';
import type { StoreApi } from 'zustand';
import { viewIdsIn } from '@/layout/split';
import type { EditorRegistry, SavedFileSetters } from '@/state/editors';
import { isConnectionError, TransportError, type Transport, type TransportStatus, fireAndForget } from '@/transport-api/transport';

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
interface FileEditorState<TDocument, TContent> extends SavedFileSetters<TDocument> {
    rev: number;
    dirty: boolean;
    /* Counts changes to the content, which is what this client saves on. */
    edits: number;
    loading: boolean;
    conflict: TDocument | null;

    load(viewId: string, document: TDocument, local: ProjectViewLocal | null): void;
    unload(): void;
    exportContent(): TContent;
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
     * Puts the unsaved `mine` on top of `theirs`, both grown from `base`, or null when they changed the
     * same part. Without it every newer file that meets unsaved work goes to the banner.
     */
    rebase?(base: TDocument, mine: TContent, theirs: TDocument): TContent | null;
    /* Keys rather than words, translated when it fails, so a changed language reaches the next error. */
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

/* One file the daemon has open for this client, with everything a save of that one file needs. */
interface OpenFile<TState, TDocument> {
    projectId: string;
    viewId: string;
    store: StoreApi<TState>;
    saveTimer: ReturnType<typeof setTimeout> | null;
    saving: Promise<void> | null;
    /* Rises with every request for the document, so a reply that arrives late never lands after a newer one. */
    generation: number;
    /* A request for the document is on its way, whose reply already says where the file stands. */
    opening: boolean;
    /* Until the first document lands the editor is on screen empty, and an edit there has no rev to be saved against. */
    loaded: boolean;
    /* The rev a refused save was already tried again on, so a refusal never turns into a circle. */
    retriedRev: number | null;
    /* The file as the daemon has it at the editor's rev, which unsaved work is rebased from. */
    base: TDocument | null;
    /* A newer file that came while a save was out, taken up once that save is answered. */
    newer: TDocument | null;
}

/* Every document this client edits is its content with a version and a rev beside it. */
function withContent<TDocument, TContent>(document: TDocument, content: TContent): TDocument {
    return { ...document, ...content };
}

/*
 * Keeps a file view on screen and its file in step, the way `ProjectClient` does for the project.
 * It follows the grid: a view coming up gets its editor at once and is then opened and loaded, one
 * going away is written out first. Edits save after a short pause, one write at a time, always
 * against the rev that was loaded; a file that moved on in the meantime goes to the banner.
 */
export class FileEditorClient<TState extends FileEditorState<TDocument, TContent>, TDocument extends { rev: number }, TContent> {
    private readonly transport: Transport;
    /* An editor lives exactly as long as the daemon holds its file open, not as long as its view is in the grid. */
    private readonly editors: EditorRegistry<TState>;
    private readonly documents: DocumentAccess;
    private readonly projects: ProjectAccess;
    private readonly channel: FileEditorChannel<TDocument, TContent>;
    private readonly saveDelayMs: number;
    private readonly flushProject: () => Promise<void>;
    private readonly unsubscribe: Array<() => void> = [];
    /* By view id, every view of this kind on screen and every one still being closed: the grid can show several files, each with a rev of its own. */
    private readonly open = new Map<string, OpenFile<TState, TDocument>>();
    /*
     * Off screen but not closed, since what they hold has not reached the file yet: the link was down,
     * a save failed or a conflict waits. They close once that is written, or go back on screen as they are.
     */
    private readonly parked = new Map<string, OpenFile<TState, TDocument>>();
    /* One round of closing at a time; a call while one runs asks for one more, which reads the grid afresh. */
    private closing: Promise<void> | null = null;
    private closeAgain = false;
    /* The socket went away, so the daemon may have forgotten these files while it was gone. */
    private reconnecting = false;
    private disposed = false;

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
        this.reconcile();
    }

    /* The file of the cell that has the focus, which is the one a banner or a menu is about. */
    private get focused(): OpenFile<TState, TDocument> | null {
        const { activeViewId } = this.documents.getState();
        return activeViewId === null ? null : (this.open.get(activeViewId) ?? null);
    }

    /* Writes pending edits now; used before a view switch, a project switch and on the way out. */
    async flush(): Promise<void> {
        await Promise.all(this.held().map((file) => this.flushOne(file)));
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
        await Promise.all(this.held().map((file) => this.reopen(file)));
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
            file.base = conflict;
            return;
        }
        state.setRev(conflict.rev);
        state.setDirty(true);
        await this.flushOne(file);
    }

    /* Lets go of the machine: no more events, and no timer or late reply that would act on a daemon the client left. */
    dispose(): void {
        this.disposed = true;
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        for (const file of this.held()) {
            this.cancelSave(file);
        }
    }

    /* Every file the daemon holds open for this client, on screen or parked. */
    private held(): OpenFile<TState, TDocument>[] {
        return [...this.open.values(), ...this.parked.values()];
    }

    private heldFile(viewId: string): OpenFile<TState, TDocument> | null {
        return this.open.get(viewId) ?? this.parked.get(viewId) ?? null;
    }

    /* Whether a reply to request `generation` of this file may still land on its editor. */
    private isCurrent(file: OpenFile<TState, TDocument>, generation: number): boolean {
        return !this.disposed && generation === file.generation && this.heldFile(file.viewId) === file;
    }

    private async flushOne(file: OpenFile<TState, TDocument>): Promise<void> {
        this.cancelSave(file);
        if (file.store.getState().dirty) {
            await this.save(file);
        } else if (file.saving) {
            await file.saving;
        }
    }

    /* A trashed view still counts, since an undo brings it back with what it held. */
    private inProject(state: ReturnType<DocumentAccess['getState']>, viewId: string): boolean {
        const held = [...state.views, ...state.trashed.map((entry) => entry.view)];
        return held.some((view) => view.id === viewId && this.channel.isView(view));
    }

    /* The views of this kind the grid has on screen, which is exactly what the daemon should hold open. */
    private wantedIn(state: ReturnType<DocumentAccess['getState']>): string[] {
        const onScreen = state.layout === null ? [] : viewIdsIn(state.layout);
        return onScreen.filter((viewId) => state.views.some((view) => view.id === viewId && this.channel.isView(view)));
    }

    /* The views the daemon should hold open now, or null between projects, when the views on screen and their project are not the same yet. */
    private target(): { projectId: string | null; viewIds: Set<string> } | null {
        const { current, switching } = this.projects.getState();
        if (switching) {
            return null;
        }
        const projectId = current?.projectId ?? null;
        return { projectId, viewIds: new Set(projectId === null ? [] : this.wantedIn(this.documents.getState())) };
    }

    /* Null between projects, which is no answer yet, so nothing closes on it. */
    private isLeaving(file: OpenFile<TState, TDocument>, target = this.target()): boolean {
        return target !== null && (target.projectId !== file.projectId || !target.viewIds.has(file.viewId));
    }

    /*
     * A view gone from the project it is in, in which case what it held may not be written, since the
     * save would resurrect the file as an orphan. A file of another project is not gone: it is written.
     */
    private isGone(file: OpenFile<TState, TDocument>): boolean {
        const projectId = this.projects.getState().current?.projectId ?? null;
        return file.projectId === projectId && !this.inProject(this.documents.getState(), file.viewId);
    }

    /* Nothing of the file waits any more: no unsaved edit, no conflict and no save on its way. */
    private isSettled(file: OpenFile<TState, TDocument>): boolean {
        const state = file.store.getState();
        return !state.dirty && state.conflict === null && file.saving === null;
    }

    private onDocument(state: ReturnType<DocumentAccess['getState']>, previous: ReturnType<DocumentAccess['getState']>): void {
        if (this.reconcile()) {
            return;
        }
        // The project was read again after a reconnect; a restarted daemon knows no rev until a file is opened.
        if (this.reconnecting && this.held().length > 0 && state.views !== previous.views) {
            this.reconnecting = false;
            void Promise.all(this.held().map((file) => this.reopen(file)));
        }
    }

    /*
     * A project arriving is what a reload looks like from here, since the document store already holds
     * the view, so nothing else would ever ask for its file.
     */
    private onProject(state: ReturnType<ProjectAccess['getState']>, previous: ReturnType<ProjectAccess['getState']>): void {
        if (state.current?.projectId !== previous.current?.projectId || state.switching !== previous.switching) {
            this.reconcile();
        }
    }

    private onStatus(status: TransportStatus): void {
        if (status !== 'open') {
            this.reconnecting = true;
        }
    }

    /*
     * Brings the files in step with the grid. A view coming on screen gets its editor in the same
     * tick, whatever is still closing, so nothing drawn there is ever an editor this client does not
     * follow; only closing waits, on the save of what goes away. Says whether anything had to move.
     */
    private reconcile(): boolean {
        const target = this.target();
        if (this.disposed || target === null) {
            return false;
        }
        let moved = false;
        for (const file of [...this.parked.values()]) {
            if (this.isGone(file)) {
                this.discard(file);
                moved = true;
            }
        }
        const { projectId, viewIds } = target;
        if (projectId !== null) {
            const { viewLocal } = this.documents.getState();
            for (const viewId of viewIds) {
                if (this.open.has(viewId)) {
                    continue;
                }
                moved = true;
                if (!this.unpark(projectId, viewId)) {
                    void this.openOne(projectId, viewId, viewLocal[viewId] ?? null);
                }
            }
        }
        if ([...this.open.values()].some((file) => this.isLeaving(file, target))) {
            moved = true;
            void this.closeLeaving();
        }
        return moved;
    }

    private closeLeaving(): Promise<void> {
        if (this.closing) {
            this.closeAgain = true;
            return this.closing;
        }
        this.closing = (async () => {
            do {
                this.closeAgain = false;
                const target = this.target();
                await Promise.all([...this.open.values()].filter((file) => this.isLeaving(file, target)).map((file) => this.close(file)));
            } while (this.closeAgain && !this.disposed);
        })().finally(() => {
            this.closing = null;
        });
        return this.closing;
    }

    private async close(file: OpenFile<TState, TDocument>): Promise<void> {
        if (this.isGone(file)) {
            this.discard(file);
            return;
        }
        await this.flushOne(file);
        // The grid may have taken the view back while the save was out, or be between projects now.
        if (this.disposed || this.open.get(file.viewId) !== file || !this.isLeaving(file)) {
            return;
        }
        if (this.isGone(file)) {
            this.discard(file);
            return;
        }
        // Taken out first, so `onEditor` does not read emptying the editor as an edit.
        this.open.delete(file.viewId);
        if (this.isSettled(file)) {
            this.release(file);
        } else {
            this.parked.set(file.viewId, file);
        }
    }

    /* A view back on screen takes its parked file as it is, since loading the file again would drop what it held. */
    private unpark(projectId: string, viewId: string): boolean {
        const file = this.parked.get(viewId);
        if (!file || file.projectId !== projectId) {
            return false;
        }
        this.parked.delete(viewId);
        this.open.set(viewId, file);
        if (file.loaded && file.store.getState().dirty) {
            this.scheduleSave(file);
        }
        return true;
    }

    /* Closes a parked file once what it held is written, or the file it was behind on has been taken. */
    private settleParked(file: OpenFile<TState, TDocument>): void {
        if (this.parked.get(file.viewId) !== file || !this.isSettled(file)) {
            return;
        }
        this.parked.delete(file.viewId);
        this.release(file);
    }

    private discard(file: OpenFile<TState, TDocument>): void {
        this.cancelSave(file);
        if (this.open.get(file.viewId) === file) {
            this.open.delete(file.viewId);
        }
        if (this.parked.get(file.viewId) === file) {
            this.parked.delete(file.viewId);
        }
        this.release(file);
    }

    private release(file: OpenFile<TState, TDocument>): void {
        file.store.getState().unload();
        this.editors.release(file.viewId);
        void fireAndForget('channel.close', this.channel.close(this.transport, file.projectId, file.viewId));
    }

    private async openOne(projectId: string, viewId: string, local: ProjectViewLocal | null): Promise<void> {
        const file: OpenFile<TState, TDocument> = {
            projectId,
            viewId,
            store: this.editors.of(viewId),
            saveTimer: null,
            saving: null,
            generation: 1,
            opening: true,
            loaded: false,
            retriedRev: null,
            base: null,
            newer: null
        };
        this.open.set(viewId, file);
        let document: TDocument;
        try {
            // A view made a moment ago is only in the file after the project save has landed.
            await this.flushProject();
            document = await this.channel.open(this.transport, projectId, viewId);
        } catch (e) {
            if (this.isCurrent(file, 1)) {
                file.opening = false;
                // Out of the map, so the next change to the grid asks again; the editor stays with whatever was drawn into it.
                if (this.open.get(viewId) === file) {
                    this.open.delete(viewId);
                }
                this.report(file, e, this.channel.errors.open);
            }
            return;
        }
        if (this.isCurrent(file, 1)) {
            file.opening = false;
            this.receive(file, document, local);
        }
    }

    /*
     * The first document of a file. Work drawn into the editor before it came had nothing to stand on,
     * so it stays on screen with the file in the banner, and a person says which of the two is kept.
     */
    private receive(file: OpenFile<TState, TDocument>, document: TDocument, local: ProjectViewLocal | null): void {
        const before = file.store.getState();
        const early = before.dirty || before.edits > 0 ? before.exportContent() : null;
        before.load(file.viewId, document, local);
        file.loaded = true;
        file.base = document;
        if (early !== null) {
            const state = file.store.getState();
            state.applyDocument(withContent(document, early));
            state.setDirty(true);
            state.setConflict(document);
            return;
        }
        this.settleParked(file);
    }

    /*
     * Asks the daemon for one file again and picks up where the two sides differ: the same rev means
     * the screen is still the file and only the daemon had forgotten, a newer one is a conflict
     * while there is unsaved work and otherwise simply what the file is now.
     */
    private async reopen(file: OpenFile<TState, TDocument>): Promise<void> {
        if (file.opening) {
            return;
        }
        const generation = ++file.generation;
        file.opening = true;
        let document: TDocument;
        try {
            document = await this.channel.open(this.transport, file.projectId, file.viewId);
        } catch (e) {
            if (this.isCurrent(file, generation)) {
                file.opening = false;
                this.report(file, e, this.channel.errors.open);
            }
            return;
        }
        if (!this.isCurrent(file, generation)) {
            return;
        }
        file.opening = false;
        if (!file.loaded) {
            this.receive(file, document, this.documents.getState().viewLocal[file.viewId] ?? null);
            return;
        }
        const state = file.store.getState();
        if (document.rev === state.rev) {
            // The file is where the screen thinks it is, so the daemon only had to be told again.
            if (state.dirty && file.retriedRev !== document.rev) {
                file.retriedRev = document.rev;
                await this.save(file);
            }
            this.settleParked(file);
            return;
        }
        this.takeNewer(file, document);
    }

    private onEditor(viewId: string, state: TState, previous: TState): void {
        const file = this.open.get(viewId);
        if (!file || state.loading || previous.loading) {
            return;
        }
        if (state.edits !== previous.edits) {
            state.setDirty(true);
            // Before the file is in there is no rev to save against; the document that arrives takes this work up.
            if (file.loaded) {
                this.scheduleSave(file);
            }
        }
    }

    private cancelSave(file: OpenFile<TState, TDocument>): void {
        if (file.saveTimer) {
            clearTimeout(file.saveTimer);
            file.saveTimer = null;
        }
    }

    private scheduleSave(file: OpenFile<TState, TDocument>): void {
        this.cancelSave(file);
        file.saveTimer = setTimeout(() => {
            file.saveTimer = null;
            // A save that was out meanwhile may have written it already.
            if (file.store.getState().dirty) {
                void this.save(file);
            }
        }, this.saveDelayMs);
    }

    private save(file: OpenFile<TState, TDocument>): Promise<void> {
        if (file.saving) {
            // One write at a time per file; the edits made meanwhile ride the next one.
            return file.saving.then(() => (file.store.getState().dirty ? this.save(file) : undefined));
        }
        const state = file.store.getState();
        // A link that is down keeps the edit dirty for `resume` to write, rather than a request that can only fail.
        if (state.conflict || !file.loaded || this.transport.status !== 'open') {
            return Promise.resolve();
        }
        state.setDirty(false);
        let stale = false;
        const content = state.exportContent();
        file.saving = this.channel
            .save(this.transport, file.projectId, file.viewId, state.rev, content)
            .then((rev) => {
                file.retriedRev = null;
                file.base = file.base === null ? null : { ...withContent(file.base, content), rev };
                file.store.getState().setRev(rev);
                file.store.getState().setError(null);
            })
            .catch((e: unknown) => {
                file.store.getState().setDirty(true);
                if (e instanceof TransportError && e.code === 'rev-conflict') {
                    // Our own write never reaches the watcher, so the newer document has to be asked for.
                    stale = true;
                    return;
                }
                this.report(file, e, this.channel.errors.save);
            })
            .finally(() => {
                file.saving = null;
                const newer = file.newer;
                file.newer = null;
                if (stale) {
                    // The refusal means the file moved on; the reopen reads where it is now.
                    void this.reopen(file);
                } else if (newer !== null && newer.rev > file.store.getState().rev) {
                    this.takeNewer(file, newer);
                } else {
                    this.settleParked(file);
                }
            });
        return file.saving;
    }

    private onChanged(projectId: string, viewId: string, document: TDocument): void {
        const file = this.heldFile(viewId);
        // Before the first document the reply to the open is what the editor loads.
        if (!file || file.projectId !== projectId || !file.loaded) {
            return;
        }
        this.takeNewer(file, document);
    }

    /*
     * A file other than the one on screen. Unsaved work goes on top of it where the channel can
     * rebase it and saves against its rev; the change itself is one step back. Only work that
     * clashes with it, or a file whose rev went back, goes to the banner.
     */
    private takeNewer(file: OpenFile<TState, TDocument>, document: TDocument): void {
        const state = file.store.getState();
        if (!state.dirty && !file.saving) {
            state.applyDocument(document);
            file.base = document;
            this.settleParked(file);
            return;
        }
        if (file.saving) {
            // What the save in flight is answered with says which rev this document follows.
            file.newer = document;
            return;
        }
        const rebased =
            this.channel.rebase && file.base !== null && document.rev > state.rev ? this.channel.rebase(file.base, state.exportContent(), document) : null;
        if (rebased === null) {
            state.setConflict(document);
            return;
        }
        state.applyDocument(withContent(document, rebased));
        file.base = document;
        state.setDirty(true);
        this.scheduleSave(file);
    }

    /* An error without a file goes to the focused editor, whose banner a person is looking at. */
    private report(file: OpenFile<TState, TDocument> | null, e: unknown, fallbackKey: string): void {
        if (isConnectionError(e)) {
            return;
        }
        const store = file?.store ?? this.focused?.store ?? this.editors.blank;
        store.getState().setError(messageOf(e, i18next.t(fallbackKey)));
    }
}
