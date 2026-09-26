import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { settled, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@ruimte/agents/watch-seam';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { tooNewMessage, viewFilePathIn, viewIdOfFile, type JsonDocumentRead, type JsonDocumentReadOptions } from './project-files.ts';
import type { ProjectStore, ProjectViewFiles } from './project-store.ts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { Serializer } from '@ruimte/agents/serializer';

// The same burst rule the project file follows: an editor or git writes more than once per save.
const WATCH_SETTLE_MS = 150;

interface OpenFile {
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
}

interface OpenProjectFiles {
    dir: string;
    privateDir: string;
    watchers: DirectoryWatcher[];
    settles: Map<string, Settled>;
    open: Map<string, OpenFile>;
}

/*
 * Everything one kind of view file decides for itself: where it lives, how it is read and written,
 * what it refuses with and what an empty one is. A drawing and a diagram fill this in; the store
 * below does the rest, which is the same for both.
 */
export interface ViewFileKind<TDocument extends TContent & { rev: number }, TContent> {
    /* The word a log line uses, which is what a person reading the console sees. */
    noun: string;
    /* The version this Ruimte writes, so a file that says a higher one can be named in the refusal. */
    version: number;
    /* Where the files of shared views sit, and where the ones of private views sit beside it. */
    dirOf(documentPath: string): string;
    privateDirOf(documentPath: string): string;
    read(path: string, options?: JsonDocumentReadOptions): Promise<JsonDocumentRead<TDocument>>;
    write(path: string, document: TDocument): Promise<string>;
    /* Only the fields of the document, so a payload never carries anything else into the file. */
    documentOf(content: TContent, rev: number): TDocument;
    /* What opening a view nobody ever saved answers. */
    empty: TDocument;
    isViewOf(projects: ProjectStore, projectId: string, viewId: string): boolean;
    /* What a save refuses before it writes, or null when the content is fine. */
    problemIn(content: TContent): string | null;
    changed(projectId: string, viewId: string, document: TDocument): SessionEvent;
    /* The refusals, each under its own code, since a client tells a drawing from a diagram by it. */
    projectNotFound(message: string): Error;
    notFound(message: string): Error;
    invalid(message: string): Error;
    revConflict(message: string): Error;
}

/*
 * The files of every open project of one kind: one file per view under `.ruimte/<kind>`, with the
 * rev discipline of the project file. It watches that directory itself, because a non-recursive
 * watch on `.ruimte` does not reliably report a write one level down on macOS.
 */
export abstract class ProjectViewFileStore<TDocument extends TContent & { rev: number }, TContent> implements ProjectViewFiles {
    protected readonly projects: ProjectStore;
    protected readonly kind: ViewFileKind<TDocument, TContent>;
    private readonly sinks = new ClientSinks();
    private readonly states = new Map<string, OpenProjectFiles>();
    // One file operation at a time, so a client's save and an agent's write never interleave on a rev.
    private readonly writes = new Serializer();

    private readonly seams: WatchSeams;

    constructor(projects: ProjectStore, kind: ViewFileKind<TDocument, TContent>, seams: WatchSeams = SYSTEM_WATCH) {
        this.projects = projects;
        this.kind = kind;
        this.seams = seams;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /*
     * What is on disk for this view, or an empty document when nothing is: a view nobody touched
     * leaves no file behind, so opening one never writes.
     */
    open(projectId: string, viewId: string): Promise<TDocument> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, viewId);
            const outcome = await this.kind.read(this.pathOf(projectId, state, viewId));
            if (outcome.kind === 'invalid') {
                throw this.kind.invalid(outcome.message);
            }
            /* Refused rather than opened empty: an empty document here would be written over the
               newer file by the first save, and that file is someone's work. */
            if (outcome.kind === 'too-new') {
                throw this.kind.invalid(tooNewMessage(this.kind.noun, outcome.version, this.kind.version));
            }
            if (outcome.kind === 'corrupt') {
                console.warn(`Set aside a ${this.kind.noun} that would not parse: ${outcome.setAside}`);
            }
            if (outcome.kind !== 'ok') {
                state.open.set(viewId, { rev: 0, lastText: '' });
                return this.kind.empty;
            }
            state.open.set(viewId, { rev: outcome.document.rev, lastText: outcome.text });
            return outcome.document;
        });
    }

    save(projectId: string, viewId: string, baseRev: number, content: TContent): Promise<number> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, viewId);
            const current = state.open.get(viewId) ?? { rev: 0, lastText: '' };
            if (baseRev !== current.rev) {
                throw this.kind.revConflict(`The ${this.kind.noun} is at rev ${current.rev}, the save was based on ${baseRev}`);
            }
            const problem = this.kind.problemIn(content);
            if (problem) {
                throw this.kind.invalid(problem);
            }
            const path = this.pathOf(projectId, state, viewId);
            // Never over a write the watcher has not reported yet: that one is taken in and the save refused.
            const onDisk = await this.kind.read(path, { setAside: false });
            if (onDisk.kind === 'ok' && onDisk.text !== current.lastText) {
                this.takeOutsideEdit(projectId, state, viewId, onDisk.document, onDisk.text);
                throw this.kind.revConflict(`The ${this.kind.noun} changed on disk; it is now at rev ${onDisk.document.rev}`);
            }
            const document = this.kind.documentOf(content, current.rev + 1);
            const text = await this.kind.write(path, document);
            state.open.set(viewId, { rev: document.rev, lastText: text });
            return document.rev;
        });
    }

    /* A duplicated view starts from the same content at rev 0; ids are unique inside a file only. */
    copy(projectId: string, from: string, to: string): Promise<void> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, to);
            const outcome = await this.kind.read(this.pathOf(projectId, state, from));
            if (outcome.kind !== 'ok') {
                // Nothing was ever saved for the source, so the copy has nothing to be.
                return;
            }
            const text = await this.kind.write(this.pathOf(projectId, state, to), this.kind.documentOf(outcome.document, 0));
            state.open.set(to, { rev: 0, lastText: text });
        });
    }

    close(projectId: string, viewId: string): void {
        this.states.get(projectId)?.open.delete(viewId);
    }

    /* Where this view's file belongs right now, which is the side of the folder its view is on. */
    private pathOf(projectId: string, state: OpenProjectFiles, viewId: string): string {
        return viewFilePathIn(this.projects.isSharedView(projectId, viewId) ? state.dir : state.privateDir, viewId);
    }

    /*
     * A view that changed sides takes its file along. Nothing is read or parsed: the bytes are the
     * person's either way, and a file that is not there is a view nobody ever drew in.
     */
    async resettle(projectId: string, viewIds: readonly string[]): Promise<void> {
        const state = this.states.get(projectId);
        if (!state) {
            return;
        }
        for (const viewId of viewIds) {
            const shared = this.projects.isSharedView(projectId, viewId);
            const from = viewFilePathIn(shared ? state.privateDir : state.dir, viewId);
            const to = viewFilePathIn(shared ? state.dir : state.privateDir, viewId);
            await mkdir(dirname(to), { recursive: true });
            await rename(from, to).catch(() => undefined);
        }
    }

    async removeOrphans(projectId: string, keep: Set<string>): Promise<void> {
        let path: string;
        try {
            path = this.projects.documentPathOf(projectId);
        } catch {
            return;
        }
        // Both sides of the folder: a view that was shared once may have left its file on either.
        for (const dir of [this.kind.dirOf(path), this.kind.privateDirOf(path)]) {
            let names: string[];
            try {
                names = await readdir(dir);
            } catch {
                continue;
            }
            for (const name of names) {
                const viewId = viewIdOfFile(name);
                if (!viewId || keep.has(viewId)) {
                    continue;
                }
                await rm(viewFilePathIn(dir, viewId), { force: true });
                this.close(projectId, viewId);
            }
        }
    }

    closeProject(projectId: string): void {
        const state = this.states.get(projectId);
        if (!state) {
            return;
        }
        for (const watcher of state.watchers) {
            watcher.close();
        }
        for (const settle of state.settles.values()) {
            settle.stop();
        }
        this.states.delete(projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.states.keys()]) {
            this.closeProject(projectId);
        }
    }

    protected locked<T>(work: () => Promise<T>): Promise<T> {
        return this.writes.run(work);
    }

    /* A view that is open here saves against this rev from now on, and its watcher stays quiet. */
    protected noteWritten(projectId: string, viewId: string, rev: number, text: string): void {
        const open = this.states.get(projectId)?.open;
        if (open?.has(viewId)) {
            open.set(viewId, { rev, lastText: text });
        }
    }

    protected emit(event: SessionEvent): void {
        this.sinks.emit(event);
    }

    /*
     * The state of one open project's files, with the directory made and the watcher running. The
     * project has to be open and the view has to be one of this kind; the client flushes its project
     * save before it opens a view it has just created.
     */
    private async stateOf(projectId: string, viewId: string): Promise<OpenProjectFiles> {
        let path: string;
        try {
            path = this.projects.documentPathOf(projectId);
        } catch {
            throw this.kind.projectNotFound(`Project ${projectId} is not open`);
        }
        if (!this.kind.isViewOf(this.projects, projectId, viewId)) {
            throw this.kind.notFound(`${viewId} is not a ${this.kind.noun} of project ${projectId}`);
        }
        const known = this.states.get(projectId);
        if (known) {
            return known;
        }
        const state: OpenProjectFiles = {
            dir: this.kind.dirOf(path),
            privateDir: this.kind.privateDirOf(path),
            watchers: [],
            settles: new Map(),
            open: new Map()
        };
        this.states.set(projectId, state);
        await mkdir(state.dir, { recursive: true });
        await mkdir(state.privateDir, { recursive: true });
        this.startWatching(projectId, state);
        return state;
    }

    /* The burst of one view file; a view keeps the same one for as long as the project is open. */
    private settleFor(state: OpenProjectFiles, projectId: string, viewId: string): Settled {
        const known = state.settles.get(viewId);
        if (known) {
            return known;
        }
        // Under the lock, so a save never reads the file between someone else's write and this reload.
        const settle = settled(this.seams, WATCH_SETTLE_MS, () =>
            this.locked(() => this.reload(projectId, state, viewId)).catch((e: unknown) => {
                console.warn(`An outside edit to the ${this.kind.noun} ${viewId} could not be taken in:`, errorText(e));
            })
        );
        state.settles.set(viewId, settle);
        return settle;
    }

    /* One watcher per directory: a pull lands in the shared one, a person's own editor in either. */
    private startWatching(projectId: string, state: OpenProjectFiles): void {
        state.watchers = [state.dir, state.privateDir]
            .map((dir) => {
                try {
                    const watcher = this.seams.watch(dir, { recursive: false }, (_event, filename) => {
                        // A platform that reports no name could have touched any file of this project.
                        const touched = filename ? [viewIdOfFile(basename(filename))] : [...state.open.keys()];
                        for (const viewId of touched) {
                            if (!viewId || !state.open.has(viewId)) {
                                continue;
                            }
                            this.settleFor(state, projectId, viewId).nudge();
                        }
                    });
                    watcher.on('error', () => undefined);
                    return watcher;
                } catch {
                    // No watcher means no outside-edit detection; saving still works.
                    return null;
                }
            })
            .filter((watcher) => watcher !== null);
    }

    private async reload(projectId: string, state: OpenProjectFiles, viewId: string): Promise<void> {
        if (this.states.get(projectId) !== state) {
            return;
        }
        const current = state.open.get(viewId);
        if (!current) {
            return;
        }
        const outcome = await this.kind.read(this.pathOf(projectId, state, viewId), { setAside: false });
        if (outcome.kind === 'invalid' || outcome.kind === 'too-new') {
            const why = outcome.kind === 'invalid' ? outcome.message : tooNewMessage(this.kind.noun, outcome.version, this.kind.version);
            console.warn(`An outside edit to the ${this.kind.noun} ${viewId} was ignored: ${why}`);
            return;
        }
        if (outcome.kind !== 'ok') {
            // Gone or half-written, and left where it is: a checkout caught halfway is whole on the
            // next event. A deleted file leaves what is on screen as it is: only the project file
            // says the view exists, and the next save writes it back.
            return;
        }
        if (outcome.text === current.lastText) {
            return;
        }
        this.takeOutsideEdit(projectId, state, viewId, outcome.document, outcome.text);
    }

    private takeOutsideEdit(projectId: string, state: OpenProjectFiles, viewId: string, document: TDocument, text: string): void {
        state.open.set(viewId, { rev: document.rev, lastText: text });
        this.emit(this.kind.changed(projectId, viewId, document));
    }
}
