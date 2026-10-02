import { readFile } from 'node:fs/promises';
import { DIAGRAM_VERSION, EMPTY_DIAGRAM, diagramProblemIn, isDiagramView, type DiagramContent, type DiagramDocument } from '@ruimte/contracts';
import type { WatchSeams } from '@ruimte/agents/watch-seam';
import { diagramsDirOf, parseDiagram, privateDiagramsDirOf, readDiagram, tooNewMessage, viewFilePathOf, writeDiagram } from './project-files.ts';
import { ProjectError, type ProjectPlace, type ProjectStore } from './project-store.ts';
import { ProjectViewFileStore, type ViewFileKind } from './view-file-store.ts';
import { CodedError } from '@ruimte/agents/coded-error';

type DiagramErrorCode = 'project-not-found' | 'diagram-not-found' | 'diagram-invalid' | 'rev-conflict';

export class DiagramError extends CodedError<DiagramErrorCode> {}

const DIAGRAM_FILES: ViewFileKind<DiagramDocument, DiagramContent> = {
    noun: 'diagram',
    version: DIAGRAM_VERSION,
    dirOf: diagramsDirOf,
    privateDirOf: privateDiagramsDirOf,
    read: readDiagram,
    write: writeDiagram,
    documentOf: (content, rev) => ({ version: DIAGRAM_VERSION, rev, meta: content.meta, nodes: content.nodes, groups: content.groups, edges: content.edges }),
    empty: EMPTY_DIAGRAM,
    isViewOf: (projects, projectId, viewId) => projects.isDiagramView(projectId, viewId),
    problemIn: diagramProblemIn,
    changed: (projectId, viewId, document) => ({ event: 'diagram.changed', payload: { projectId, viewId, document } }),
    projectNotFound: (message) => new DiagramError('project-not-found', message),
    notFound: (message) => new DiagramError('diagram-not-found', message),
    invalid: (message) => new DiagramError('diagram-invalid', message),
    revConflict: (message) => new DiagramError('rev-conflict', message)
};

/*
 * The diagrams of every project, one file per diagram view under `.ruimte/diagrams`. It differs from
 * a drawing in one place. `write` lands a whole diagram in a project nobody has open, because an
 * agent keeps working after the person switched away and `project.release` let go of the project
 * then: it finds the project on disk, writes under the store's lock and keeps nothing open afterwards.
 */
export class DiagramStore extends ProjectViewFileStore<DiagramDocument, DiagramContent> {
    constructor(projects: ProjectStore, seams?: WatchSeams) {
        super(projects, DIAGRAM_FILES, seams);
    }

    /*
     * Replaces the whole diagram of a view, open or not, and tells every client. There is no base
     * rev: whoever writes this way rewrote the diagram on purpose, so the file on disk is the rev it
     * builds on, and a client with unsaved edits gets the conflict banner rather than a silent loss.
     * A file under the name that is not a diagram is refused, never written over.
     */
    write(projectId: string, viewId: string, content: DiagramContent): Promise<number> {
        return this.lockedInPlace(async (placeOf) => {
            const problem = diagramProblemIn(content);
            if (problem) {
                throw new DiagramError('diagram-invalid', problem);
            }
            let place: ProjectPlace;
            try {
                place = await placeOf(projectId);
            } catch (e) {
                if (e instanceof ProjectError && (e.code === 'project-not-found' || e.code === 'project-missing')) {
                    throw new DiagramError('project-not-found', e.message);
                }
                throw e;
            }
            if (!place.views.some((view) => view.id === viewId && isDiagramView(view))) {
                throw new DiagramError('diagram-not-found', `${viewId} is not a diagram of project ${projectId}`);
            }
            const path = viewFilePathOf(place.documentPath, 'diagram', viewId, place.shared);
            const outcome = await readDiagram(path);
            if (outcome.kind === 'invalid') {
                throw new DiagramError('diagram-invalid', `The file of ${viewId} is not a diagram Ruimte will write over: ${outcome.message}`);
            }
            if (outcome.kind === 'too-new') {
                throw new DiagramError('diagram-invalid', tooNewMessage('diagram', outcome.version, DIAGRAM_VERSION));
            }
            const document = DIAGRAM_FILES.documentOf(content, (outcome.kind === 'ok' ? outcome.document.rev : 0) + 1);
            const text = await writeDiagram(path, document);
            this.noteWritten(projectId, viewId, document.rev, text);
            this.emit(DIAGRAM_FILES.changed(projectId, viewId, document));
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
            text = await readFile(viewFilePathOf(place.documentPath, 'diagram', viewId, place.shared), 'utf8');
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                return EMPTY_DIAGRAM;
            }
            throw e;
        }
        const parsed = parseDiagram(text);
        return parsed.kind === 'ok' ? parsed.document : null;
    }
}
