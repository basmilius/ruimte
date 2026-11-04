import { CodedError, type WatchSeams } from '@adecore/agents';
import { DIAGRAM_VERSION, EMPTY_DIAGRAM, diagramProblemIn, isDiagramView, type DiagramContent, type DiagramDocument } from '@ruimte/contracts';
import { diagramsDirOf, privateDiagramsDirOf, readDiagram, tooNewMessage, writeDiagram } from './project-files.ts';
import type { ProjectStore } from './project-store.ts';
import { ProjectViewFileStore, type ViewFileKind } from './view-file-store.ts';

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
    isView: isDiagramView,
    problemIn: diagramProblemIn,
    changed: (projectId, viewId, document) => ({ event: 'diagram.changed', payload: { projectId, viewId, document } }),
    projectNotFound: (message) => new DiagramError('project-not-found', message),
    notFound: (message) => new DiagramError('diagram-not-found', message),
    invalid: (message) => new DiagramError('diagram-invalid', message),
    revConflict: (message) => new DiagramError('rev-conflict', message)
};

/*
 * The diagrams of every project, one file per diagram view under `.ruimte/diagrams`. Unlike a
 * drawing, `write` lands a whole diagram in a project nobody has open, because an agent keeps working
 * after the person switched away: it writes under the store's lock and keeps nothing open afterwards.
 */
export class DiagramStore extends ProjectViewFileStore<DiagramDocument, DiagramContent> {
    constructor(projects: ProjectStore, seams?: WatchSeams) {
        super(projects, DIAGRAM_FILES, seams);
    }

    /*
     * Replaces the whole diagram of a view, open or not, and tells every client. There is no base
     * rev: whoever writes this way rewrote the diagram on purpose, so it builds on the file on disk,
     * and a client with unsaved edits gets the conflict banner rather than a silent loss. A file under
     * the name that is not a diagram is refused, never written over.
     */
    write(projectId: string, viewId: string, content: DiagramContent): Promise<number> {
        return this.lockedInPlace(projectId, async (placeOf) => {
            const problem = diagramProblemIn(content);
            if (problem) {
                throw new DiagramError('diagram-invalid', problem);
            }
            const path = this.pathIn(await this.viewPlace(placeOf, projectId, viewId), viewId);
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
}
