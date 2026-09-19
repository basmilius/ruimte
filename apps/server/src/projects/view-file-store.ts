import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { SYSTEM_WATCH, type DirectoryWatcher, type WatchSeams } from '../fs/watch-seam.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { viewFilePathIn, viewIdOfFile, type JsonDocumentRead } from './project-files.ts';
import type { ProjectStore, ProjectViewFiles } from './project-store.ts';
import { ClientSinks } from '../client-sinks.ts';

// The same burst rule the project file follows: an editor or git writes more than once per save.
const WATCH_SETTLE_MS = 150;

interface OpenFile {
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
}

interface OpenProjectFiles {
    dir: string;
    watcher: DirectoryWatcher | null;
    cancelSettles: Map<string, () => void>;
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
    dirOf(documentPath: string): string;
    read(path: string): Promise<JsonDocumentRead<TDocument>>;
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
    private chain: Promise<unknown> = Promise.resolve();

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
            const outcome = await this.kind.read(viewFilePathIn(state.dir, viewId));
            if (outcome.kind === 'invalid') {
                throw this.kind.invalid(outcome.message);
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
            const document = this.kind.documentOf(content, current.rev + 1);
            const text = await this.kind.write(viewFilePathIn(state.dir, viewId), document);
            state.open.set(viewId, { rev: document.rev, lastText: text });
            return document.rev;
        });
    }

    /* A duplicated view starts from the same content at rev 0; ids are unique inside a file only. */
    copy(projectId: string, from: string, to: string): Promise<void> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, to);
            const outcome = await this.kind.read(viewFilePathIn(state.dir, from));
            if (outcome.kind !== 'ok') {
                // Nothing was ever saved for the source, so the copy has nothing to be.
                return;
            }
            const text = await this.kind.write(viewFilePathIn(state.dir, to), this.kind.documentOf(outcome.document, 0));
            state.open.set(to, { rev: 0, lastText: text });
        });
    }

    close(projectId: string, viewId: string): void {
        this.states.get(projectId)?.open.delete(viewId);
    }

    async removeOrphans(projectId: string, keep: Set<string>): Promise<void> {
        let dir: string;
        try {
            dir = this.kind.dirOf(this.projects.documentPathOf(projectId));
        } catch {
            return;
        }
        let names: string[];
        try {
            names = await readdir(dir);
        } catch {
            return;
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

    closeProject(projectId: string): void {
        const state = this.states.get(projectId);
        if (!state) {
            return;
        }
        state.watcher?.close();
        for (const cancel of state.cancelSettles.values()) {
            cancel();
        }
        this.states.delete(projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.states.keys()]) {
            this.closeProject(projectId);
        }
    }

    protected locked<T>(work: () => Promise<T>): Promise<T> {
        const run = this.chain.then(work, work);
        this.chain = run.catch(() => undefined);
        return run;
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
        const state: OpenProjectFiles = { dir: this.kind.dirOf(path), watcher: null, cancelSettles: new Map(), open: new Map() };
        this.states.set(projectId, state);
        await mkdir(state.dir, { recursive: true });
        this.startWatching(projectId, state);
        return state;
    }

    private startWatching(projectId: string, state: OpenProjectFiles): void {
        try {
            state.watcher = this.seams.watch(state.dir, { recursive: false }, (_event, filename) => {
                // A platform that reports no name could have touched any file of this project.
                const touched = filename ? [viewIdOfFile(basename(filename))] : [...state.open.keys()];
                for (const viewId of touched) {
                    if (!viewId || !state.open.has(viewId)) {
                        continue;
                    }
                    state.cancelSettles.get(viewId)?.();
                    state.cancelSettles.set(
                        viewId,
                        this.seams.schedule(() => {
                            state.cancelSettles.delete(viewId);
                            return this.reload(projectId, state, viewId);
                        }, WATCH_SETTLE_MS)
                    );
                }
            });
            state.watcher.on('error', () => undefined);
        } catch {
            // No watcher means no outside-edit detection; saving still works.
        }
    }

    private async reload(projectId: string, state: OpenProjectFiles, viewId: string): Promise<void> {
        if (this.states.get(projectId) !== state) {
            return;
        }
        const current = state.open.get(viewId);
        if (!current) {
            return;
        }
        const outcome = await this.kind.read(viewFilePathIn(state.dir, viewId));
        if (outcome.kind === 'invalid') {
            console.warn(`An outside edit to the ${this.kind.noun} ${viewId} was ignored: ${outcome.message}`);
            return;
        }
        if (outcome.kind !== 'ok') {
            // Gone or half-written. A deleted file leaves what is on screen as it is: only the
            // project file says the view exists, and the next save writes it back.
            return;
        }
        if (outcome.text === current.lastText) {
            return;
        }
        state.open.set(viewId, { rev: outcome.document.rev, lastText: outcome.text });
        this.emit(this.kind.changed(projectId, viewId, outcome.document));
    }
}
