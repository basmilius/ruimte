import { EMPTY_DRAWING, type DrawingContent, type DrawingDocument, type DrawingElement } from '@ruimte/contracts';
import type { WatchSeams } from '../fs/watch-seam.ts';
import { drawingsDirOf, readDrawing, viewFilePathIn, writeDrawing } from './project-files.ts';
import type { ProjectStore } from './project-store.ts';
import { ProjectViewFileStore, type ViewFileKind } from './view-file-store.ts';
import { CodedError } from '../coded-error.ts';

type DrawingErrorCode = 'project-not-found' | 'drawing-not-found' | 'drawing-invalid' | 'rev-conflict';

export class DrawingError extends CodedError<DrawingErrorCode> {}

const DRAWING_FILES: ViewFileKind<DrawingDocument, DrawingContent> = {
    noun: 'drawing',
    dirOf: drawingsDirOf,
    read: readDrawing,
    write: writeDrawing,
    documentOf: (content, rev) => ({ version: 1, rev, elements: content.elements }),
    empty: EMPTY_DRAWING,
    isViewOf: (projects, projectId, viewId) => projects.isDrawingView(projectId, viewId),
    // A drawing has no rule a save could break: an element is whatever the schema let through.
    problemIn: () => null,
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
            const outcome = await readDrawing(viewFilePathIn(drawingsDirOf(this.projects.documentPathOf(projectId)), viewId));
            return outcome.kind === 'ok' ? outcome.document.elements : [];
        }
        return null;
    }
}
