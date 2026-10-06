import { DRAWING_VERSION, EMPTY_DRAWING, duplicateElementIdIn, type DrawingContent, type DrawingDocument, type DrawingElement } from '@ruimte/contracts';
import type { WatchSeams } from '@adecore/agents/watch-seam';
import { drawingsDirOf, privateDrawingsDirOf, readDrawing, tooNewMessage, viewFilePathOf, writeDrawing } from './project-files.ts';
import type { ProjectStore } from './project-store.ts';
import { ProjectViewFileStore, type ViewFileKind } from './view-file-store.ts';
import { CodedError } from '@adecore/agents/coded-error';

type DrawingErrorCode = 'project-not-found' | 'drawing-not-found' | 'drawing-invalid' | 'rev-conflict';

export class DrawingError extends CodedError<DrawingErrorCode> {}

const DRAWING_FILES: ViewFileKind<DrawingDocument, DrawingContent> = {
    noun: 'drawing',
    version: DRAWING_VERSION,
    dirOf: drawingsDirOf,
    privateDirOf: privateDrawingsDirOf,
    read: readDrawing,
    write: writeDrawing,
    documentOf: (content, rev) => ({ version: DRAWING_VERSION, rev, elements: content.elements }),
    empty: EMPTY_DRAWING,
    isViewOf: (projects, projectId, viewId) => projects.isDrawingView(projectId, viewId),
    // The read refuses a file with two elements under one id, so a save must never write one.
    problemIn: (content) => {
        const duplicate = duplicateElementIdIn(content.elements);
        return duplicate === null ? null : `Two elements in this drawing would share the id "${duplicate}"`;
    },
    changed: (projectId, viewId, document) => ({ event: 'drawing.changed', payload: { projectId, viewId, document } }),
    projectNotFound: (message) => new DrawingError('project-not-found', message),
    notFound: (message) => new DrawingError('drawing-not-found', message),
    invalid: (message) => new DrawingError('drawing-invalid', message),
    revConflict: (message) => new DrawingError('rev-conflict', message)
};

/* The drawings of every open project, one file per drawing view under `.ruimte/drawings`. */
export class DrawingStore extends ProjectViewFileStore<DrawingDocument, DrawingContent> {
    constructor(projects: ProjectStore, seams?: WatchSeams) {
        super(projects, DRAWING_FILES, seams);
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
            const place = await this.projects.place(projectId);
            const outcome = await readDrawing(viewFilePathOf(place.documentPath, 'drawing', viewId, place.shared), { setAside: false });
            if (outcome.kind === 'ok') {
                return outcome.document.elements;
            }
            if (outcome.kind === 'missing') {
                return [];
            }
            throw new DrawingError(
                'drawing-invalid',
                outcome.kind === 'too-new'
                    ? tooNewMessage('drawing', outcome.version, DRAWING_VERSION)
                    : outcome.kind === 'invalid'
                      ? outcome.message
                      : 'The drawing on disk could not be read'
            );
        }
        return null;
    }
}
