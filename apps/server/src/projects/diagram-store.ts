import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { EMPTY_DIAGRAM, diagramProblemIn, isDiagramView, type DiagramContent, type DiagramDocument, type ProjectView } from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { diagramsDirOf, parseDiagram, readDiagram, viewFilePathIn, viewIdOfFile, writeDiagram } from './project-files.ts';
import { ProjectError, type ProjectStore, type ProjectViewFiles } from './project-store.ts';

type DiagramErrorCode = 'project-not-found' | 'diagram-not-found' | 'diagram-invalid' | 'rev-conflict';

export class DiagramError extends Error {
    readonly code: DiagramErrorCode;

    constructor(code: DiagramErrorCode, message: string) {
        super(message);
        this.name = 'DiagramError';
        this.code = code;
    }
}

// The same burst rule the project file and the drawings follow: an editor or git writes more than once per save.
const WATCH_SETTLE_MS = 150;

interface OpenDiagram {
    rev: number;
    // The exact text last written or read, so the watcher can tell our own write from someone else's.
    lastText: string;
}

interface OpenProjectDiagrams {
    dir: string;
    watcher: FSWatcher | null;
    settles: Map<string, ReturnType<typeof setTimeout>>;
    open: Map<string, OpenDiagram>;
}

/* Only the fields of a diagram, so a payload never carries anything else into the file. */
const documentOf = (content: DiagramContent, rev: number): DiagramDocument => ({
    version: 1,
    rev,
    meta: content.meta,
    nodes: content.nodes,
    groups: content.groups,
    edges: content.edges
});

/*
 * The diagrams of every project: one file per diagram view under `.ruimte/diagrams`, with the rev
 * discipline and the watcher of the drawing store. It differs in one place. `write` lands a whole
 * diagram in a project nobody has open, because an agent keeps working after the person switched
 * away and `project.release` let go of the project then: it finds the project on disk, writes under
 * the store's lock and keeps nothing open afterwards.
 */
export class DiagramStore implements ProjectViewFiles {
    private readonly projects: ProjectStore;
    private readonly sinks = new Map<string, SessionSink>();
    private readonly states = new Map<string, OpenProjectDiagrams>();
    // One file operation at a time, so a client's save and an agent's write never interleave on a rev.
    private chain: Promise<unknown> = Promise.resolve();

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
     * What is on disk for this view, or an empty diagram when nothing is: a diagram nobody wrote
     * leaves no file behind, so opening one never writes.
     */
    open(projectId: string, viewId: string): Promise<DiagramDocument> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, viewId);
            const outcome = await readDiagram(viewFilePathIn(state.dir, viewId));
            if (outcome.kind === 'invalid') {
                throw new DiagramError('diagram-invalid', outcome.message);
            }
            if (outcome.kind === 'corrupt') {
                console.warn(`Set aside a diagram that would not parse: ${outcome.setAside}`);
            }
            if (outcome.kind !== 'ok') {
                state.open.set(viewId, { rev: 0, lastText: '' });
                return EMPTY_DIAGRAM;
            }
            state.open.set(viewId, { rev: outcome.document.rev, lastText: outcome.text });
            return outcome.document;
        });
    }

    save(projectId: string, viewId: string, baseRev: number, content: DiagramContent): Promise<number> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, viewId);
            const current = state.open.get(viewId) ?? { rev: 0, lastText: '' };
            if (baseRev !== current.rev) {
                throw new DiagramError('rev-conflict', `The diagram is at rev ${current.rev}, the save was based on ${baseRev}`);
            }
            const problem = diagramProblemIn(content);
            if (problem) {
                throw new DiagramError('diagram-invalid', problem);
            }
            const document = documentOf(content, current.rev + 1);
            const text = await writeDiagram(viewFilePathIn(state.dir, viewId), document);
            state.open.set(viewId, { rev: document.rev, lastText: text });
            return document.rev;
        });
    }

    /* A duplicated view starts from the same graph at rev 0. */
    copy(projectId: string, from: string, to: string): Promise<void> {
        return this.locked(async () => {
            const state = await this.stateOf(projectId, to);
            const outcome = await readDiagram(viewFilePathIn(state.dir, from));
            if (outcome.kind !== 'ok') {
                // Nothing was ever saved for the source, so the copy has nothing to be.
                return;
            }
            const text = await writeDiagram(viewFilePathIn(state.dir, to), documentOf(outcome.document, 0));
            state.open.set(to, { rev: 0, lastText: text });
        });
    }

    /*
     * Replaces the whole diagram of a view, open or not, and tells every client. There is no base
     * rev: whoever writes this way rewrote the diagram on purpose, so the file on disk is the rev it
     * builds on, and a client with unsaved edits gets the conflict banner rather than a silent loss.
     * A file under the name that is not a diagram is refused, never written over.
     */
    write(projectId: string, viewId: string, content: DiagramContent): Promise<number> {
        return this.locked(async () => {
            const problem = diagramProblemIn(content);
            if (problem) {
                throw new DiagramError('diagram-invalid', problem);
            }
            let place: { documentPath: string; views: ProjectView[] };
            try {
                place = await this.projects.place(projectId);
            } catch (e) {
                if (e instanceof ProjectError && (e.code === 'project-not-found' || e.code === 'project-missing')) {
                    throw new DiagramError('project-not-found', e.message);
                }
                throw e;
            }
            if (!place.views.some((view) => view.id === viewId && isDiagramView(view))) {
                throw new DiagramError('diagram-not-found', `${viewId} is not a diagram of project ${projectId}`);
            }
            const path = viewFilePathIn(diagramsDirOf(place.documentPath), viewId);
            const outcome = await readDiagram(path);
            if (outcome.kind === 'invalid') {
                throw new DiagramError('diagram-invalid', `The file of ${viewId} is not a diagram Ruimte will write over: ${outcome.message}`);
            }
            const document = documentOf(content, (outcome.kind === 'ok' ? outcome.document.rev : 0) + 1);
            const text = await writeDiagram(path, document);
            // A client that has it open saves against this rev from now on, and its watcher stays quiet.
            const open = this.states.get(projectId)?.open;
            if (open?.has(viewId)) {
                open.set(viewId, { rev: document.rev, lastText: text });
            }
            this.emit({ event: 'diagram.changed', payload: { projectId, viewId, document } });
            return document.rev;
        });
    }

    /*
     * What an agent reads: the diagram of a view, open or not, or null when the project has no
     * diagram under that id or its file is not one. Unlike `open` it never sets a broken file
     * aside, since a read nobody asked to repair anything should leave the folder as it found it.
     */
    async read(projectId: string, viewId: string): Promise<DiagramDocument | null> {
        const place = await this.projects.place(projectId).catch(() => null);
        if (!place || !place.views.some((view) => view.id === viewId && isDiagramView(view))) {
            return null;
        }
        let text: string;
        try {
            text = await readFile(viewFilePathIn(diagramsDirOf(place.documentPath), viewId), 'utf8');
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                return EMPTY_DIAGRAM;
            }
            throw e;
        }
        const parsed = parseDiagram(text);
        return parsed.kind === 'ok' ? parsed.document : null;
    }

    close(projectId: string, viewId: string): void {
        this.states.get(projectId)?.open.delete(viewId);
    }

    async removeOrphans(projectId: string, keep: Set<string>): Promise<void> {
        let dir: string;
        try {
            dir = diagramsDirOf(this.projects.documentPathOf(projectId));
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

    private locked<T>(work: () => Promise<T>): Promise<T> {
        const run = this.chain.then(work, work);
        this.chain = run.catch(() => undefined);
        return run;
    }

    /*
     * The state of one open project's diagrams, with the directory made and the watcher running.
     * The project has to be open and the view has to be a diagram view of it; the client flushes its
     * project save before it opens a diagram it has just created.
     */
    private async stateOf(projectId: string, viewId: string): Promise<OpenProjectDiagrams> {
        let path: string;
        try {
            path = this.projects.documentPathOf(projectId);
        } catch {
            throw new DiagramError('project-not-found', `Project ${projectId} is not open`);
        }
        if (!this.projects.isDiagramView(projectId, viewId)) {
            throw new DiagramError('diagram-not-found', `${viewId} is not a diagram of project ${projectId}`);
        }
        const known = this.states.get(projectId);
        if (known) {
            return known;
        }
        const state: OpenProjectDiagrams = { dir: diagramsDirOf(path), watcher: null, settles: new Map(), open: new Map() };
        this.states.set(projectId, state);
        await mkdir(state.dir, { recursive: true });
        this.startWatching(projectId, state);
        return state;
    }

    private startWatching(projectId: string, state: OpenProjectDiagrams): void {
        try {
            state.watcher = watch(state.dir, (_event, filename) => {
                // A platform that reports no name could have touched any diagram of this project.
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

    private async reload(projectId: string, state: OpenProjectDiagrams, viewId: string): Promise<void> {
        if (this.states.get(projectId) !== state) {
            return;
        }
        const current = state.open.get(viewId);
        if (!current) {
            return;
        }
        const outcome = await readDiagram(viewFilePathIn(state.dir, viewId));
        if (outcome.kind === 'invalid') {
            console.warn(`An outside edit to the diagram ${viewId} was ignored: ${outcome.message}`);
            return;
        }
        if (outcome.kind !== 'ok') {
            // Gone or half-written. A deleted file leaves the diagram as it is: only the project
            // file says a diagram exists, and the next save writes it back.
            return;
        }
        if (outcome.text === current.lastText) {
            return;
        }
        state.open.set(viewId, { rev: outcome.document.rev, lastText: outcome.text });
        this.emit({ event: 'diagram.changed', payload: { projectId, viewId, document: outcome.document } });
    }

    private emit(event: SessionEvent): void {
        for (const sink of this.sinks.values()) {
            sink(event);
        }
    }
}
