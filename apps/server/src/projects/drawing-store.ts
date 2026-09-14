import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { EMPTY_DRAWING, type DrawingContent, type DrawingDocument, type DrawingElement } from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { drawingsDirOf, readDrawing, viewFilePathIn, viewIdOfFile, writeDrawing } from './project-files.ts';
import type { ProjectStore, ProjectViewFiles } from './project-store.ts';

type DrawingErrorCode = 'project-not-found' | 'drawing-not-found' | 'drawing-invalid' | 'rev-conflict';

export class DrawingError extends Error {
    readonly code: DrawingErrorCode;

    constructor(code: DrawingErrorCode, message: string) {
        super(message);
        this.name = 'DrawingError';
        this.code = code;
    }
}

// The same burst rule the project file follows: an editor or git writes more than once per save.
const WATCH_SETTLE_MS = 150;

interface OpenDrawing {
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
}

interface OpenProjectDrawings {
    dir: string;
    watcher: FSWatcher | null;
    settles: Map<string, ReturnType<typeof setTimeout>>;
    open: Map<string, OpenDrawing>;
}

/*
 * The drawings of every open project: one file per drawing view under `.ruimte/drawings`, with the
 * rev discipline of the project file. It watches that directory itself, because a non-recursive
 * watch on `.ruimte` does not reliably report a write one level down on macOS.
 */
export class DrawingStore implements ProjectViewFiles {
    private readonly projects: ProjectStore;
    private readonly sinks = new Map<string, SessionSink>();
    private readonly states = new Map<string, OpenProjectDrawings>();

    constructor(projects: ProjectStore) {
        this.projects = projects;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    /*
     * What is on disk for this view, or an empty drawing when nothing is: a drawing nobody touched
     * leaves no file behind, so opening one never writes.
     */
    async open(projectId: string, viewId: string): Promise<DrawingDocument> {
        const state = await this.stateOf(projectId, viewId);
        const outcome = await readDrawing(viewFilePathIn(state.dir, viewId));
        if (outcome.kind === 'invalid') {
            throw new DrawingError('drawing-invalid', outcome.message);
        }
        if (outcome.kind === 'corrupt') {
            console.warn(`Set aside a drawing that would not parse: ${outcome.setAside}`);
        }
        if (outcome.kind !== 'ok') {
            state.open.set(viewId, { rev: 0, lastText: '' });
            return EMPTY_DRAWING;
        }
        state.open.set(viewId, { rev: outcome.document.rev, lastText: outcome.text });
        return outcome.document;
    }

    async save(projectId: string, viewId: string, baseRev: number, content: DrawingContent): Promise<number> {
        const state = await this.stateOf(projectId, viewId);
        const current = state.open.get(viewId) ?? { rev: 0, lastText: '' };
        if (baseRev !== current.rev) {
            throw new DrawingError('rev-conflict', `The drawing is at rev ${current.rev}, the save was based on ${baseRev}`);
        }
        const document: DrawingDocument = { version: 1, rev: current.rev + 1, elements: content.elements };
        const text = await writeDrawing(viewFilePathIn(state.dir, viewId), document);
        state.open.set(viewId, { rev: document.rev, lastText: text });
        return document.rev;
    }

    /* A duplicated view starts from the same elements at rev 0; ids are unique inside a file only. */
    async copy(projectId: string, from: string, to: string): Promise<void> {
        const state = await this.stateOf(projectId, to);
        const outcome = await readDrawing(viewFilePathIn(state.dir, from));
        if (outcome.kind !== 'ok') {
            // Nothing was ever saved for the source, so the copy has nothing to be.
            return;
        }
        const document: DrawingDocument = { version: 1, rev: 0, elements: outcome.document.elements };
        const text = await writeDrawing(viewFilePathIn(state.dir, to), document);
        state.open.set(to, { rev: 0, lastText: text });
    }

    /*
     * The elements behind a view id, whichever open project holds it, or null when no open project
     * has such a drawing. The agent context reads through this: it knows the view, not the project.
     */
    async elementsOf(viewId: string): Promise<DrawingElement[] | null> {
        for (const projectId of this.projects.openProjectIds()) {
            if (!this.projects.isDrawingView(projectId, viewId)) {
                continue;
            }
            const outcome = await readDrawing(viewFilePathIn(drawingsDirOf(this.projects.documentPathOf(projectId)), viewId));
            return outcome.kind === 'ok' ? outcome.document.elements : [];
        }
        return null;
    }

    close(projectId: string, viewId: string): void {
        this.states.get(projectId)?.open.delete(viewId);
    }

    async removeOrphans(projectId: string, keep: Set<string>): Promise<void> {
        let dir: string;
        try {
            dir = drawingsDirOf(this.projects.documentPathOf(projectId));
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
        for (const settle of state.settles.values()) {
            clearTimeout(settle);
        }
        this.states.delete(projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.states.keys()]) {
            this.closeProject(projectId);
        }
    }

    /*
     * The state of one project's drawings, with the directory made and the watcher running. The
     * project has to be open and the view has to be a drawing view of it; the client flushes its
     * project save before it opens a drawing it has just created.
     */
    private async stateOf(projectId: string, viewId: string): Promise<OpenProjectDrawings> {
        let path: string;
        try {
            path = this.projects.documentPathOf(projectId);
        } catch {
            throw new DrawingError('project-not-found', `Project ${projectId} is not open`);
        }
        if (!this.projects.isDrawingView(projectId, viewId)) {
            throw new DrawingError('drawing-not-found', `${viewId} is not a drawing of project ${projectId}`);
        }
        const known = this.states.get(projectId);
        if (known) {
            return known;
        }
        const state: OpenProjectDrawings = { dir: drawingsDirOf(path), watcher: null, settles: new Map(), open: new Map() };
        this.states.set(projectId, state);
        await mkdir(state.dir, { recursive: true });
        this.startWatching(projectId, state);
        return state;
    }

    private startWatching(projectId: string, state: OpenProjectDrawings): void {
        try {
            state.watcher = watch(state.dir, (_event, filename) => {
                // A platform that reports no name could have touched any drawing of this project.
                const touched = filename ? [viewIdOfFile(basename(filename))] : [...state.open.keys()];
                for (const viewId of touched) {
                    if (!viewId || !state.open.has(viewId)) {
                        continue;
                    }
                    const settle = state.settles.get(viewId);
                    if (settle) {
                        clearTimeout(settle);
                    }
                    state.settles.set(
                        viewId,
                        setTimeout(() => {
                            state.settles.delete(viewId);
                            void this.reload(projectId, state, viewId);
                        }, WATCH_SETTLE_MS)
                    );
                }
            });
            state.watcher.on('error', () => undefined);
        } catch {
            // No watcher means no outside-edit detection; saving still works.
        }
    }

    private async reload(projectId: string, state: OpenProjectDrawings, viewId: string): Promise<void> {
        if (this.states.get(projectId) !== state) {
            return;
        }
        const current = state.open.get(viewId);
        if (!current) {
            return;
        }
        const outcome = await readDrawing(viewFilePathIn(state.dir, viewId));
        if (outcome.kind === 'invalid') {
            console.warn(`An outside edit to the drawing ${viewId} was ignored: ${outcome.message}`);
            return;
        }
        if (outcome.kind !== 'ok') {
            // Gone or half-written. A deleted file leaves the drawing as it is: only the project
            // file says a drawing exists, and the next save writes it back.
            return;
        }
        if (outcome.text === current.lastText) {
            return;
        }
        state.open.set(viewId, { rev: outcome.document.rev, lastText: outcome.text });
        this.emit({ event: 'drawing.changed', payload: { projectId, viewId, document: outcome.document } });
    }

    private emit(event: SessionEvent): void {
        for (const sink of this.sinks.values()) {
            sink(event);
        }
    }
}
