import { CodedError, type WatchSeams } from '@adecore/agents';
import { applyDrawingEdit, type DrawingEdit, type DrawingEditMint, type DrawingEditProblem } from '@adecore/drawing';
import {
    DRAWING_VERSION,
    EMPTY_DRAWING,
    duplicateElementIdIn,
    isDrawingView,
    type DrawingContent,
    type DrawingDocument,
    type DrawingElement
} from '@ruimte/contracts';
import type { SessionEvent } from '../wire.ts';
import { ElementChanges } from './element-changes.ts';
import { drawingsDirOf, privateDrawingsDirOf, readDrawing, tooNewMessage, writeDrawing } from './project-files.ts';
import type { ProjectStore } from './project-store.ts';
import { ProjectViewFileStore, type ViewFileKind } from './view-file-store.ts';

type DrawingErrorCode = 'project-not-found' | 'drawing-not-found' | 'drawing-invalid' | 'rev-conflict' | 'bad-edit';

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
    isView: isDrawingView,
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
    private readonly changes = new ElementChanges();

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
            const outcome = await readDrawing(this.pathIn(await this.projects.place(projectId), viewId), { setAside: false });
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

    override async open(projectId: string, viewId: string): Promise<DrawingDocument> {
        const document = await super.open(projectId, viewId);
        this.changes.note(changeKey(projectId, viewId), document);
        return document;
    }

    override async read(projectId: string, viewId: string): Promise<DrawingDocument | null> {
        const document = await super.read(projectId, viewId);
        // The empty drawing stands for a missing file, which says nothing about what changed.
        if (document !== null && document !== EMPTY_DRAWING) {
            this.changes.note(changeKey(projectId, viewId), document);
        }
        return document;
    }

    /*
     * One edit by element id on the drawing of a view, open or not, and every client told. It builds on
     * the file as it is now, so a person drawing elsewhere loses nothing; only an update or a remove of
     * an element that changed after `revision` is a conflict. A dry run checks all of it and writes nothing.
     */
    edit(projectId: string, viewId: string, revision: number, edit: DrawingEdit, options: { dryRun: boolean; mint: DrawingEditMint }): Promise<DrawingEdited> {
        return this.lockedInPlace(projectId, async (placeOf) => {
            const path = this.pathIn(await this.viewPlace(placeOf, projectId, viewId), viewId);
            const outcome = await readDrawing(path, { setAside: false });
            if (outcome.kind === 'invalid' || outcome.kind === 'too-new') {
                const why = outcome.kind === 'invalid' ? outcome.message : tooNewMessage('drawing', outcome.version, DRAWING_VERSION);
                throw new DrawingError('drawing-invalid', `The file of ${viewId} is not a drawing Ruimte will write over: ${why}`);
            }
            if (outcome.kind === 'unreadable' || outcome.kind === 'corrupt') {
                throw new DrawingError('drawing-invalid', `The file of ${viewId} could not be read`);
            }
            const current = outcome.kind === 'ok' ? outcome.document : EMPTY_DRAWING;
            if (revision > current.rev) {
                throw new DrawingError('rev-conflict', `${viewId} is at revision ${current.rev}, so it never was at ${revision}`);
            }
            const named = [...(edit.update ?? []).map((patch) => patch.id), ...(edit.remove ?? [])];
            const stale = this.changes.changedSince(changeKey(projectId, viewId), current, revision, named);
            if (stale.length > 0) {
                throw new DrawingError(
                    'rev-conflict',
                    `${stale.join(', ')} changed after revision ${revision}; the drawing is at ${current.rev} now`,
                    stale.map((id) => `changed\t${id}`)
                );
            }
            const taken = new Set(current.elements.map((element) => element.id));
            const unique = (): string => {
                let id = options.mint.id();
                while (taken.has(id)) {
                    id = options.mint.id();
                }
                taken.add(id);
                return id;
            };
            const applied = applyDrawingEdit(current.elements, edit, { id: unique, seed: () => options.mint.seed() });
            if (!applied.ok) {
                const [first] = applied.problems;
                throw new DrawingError('bad-edit', `${pathText(first!) || 'edit'} ${first!.message}`, applied.problems.map(problemLine));
            }
            if (options.dryRun) {
                return { rev: current.rev, added: applied.added, elements: applied.elements.length };
            }
            const document: DrawingDocument = { version: DRAWING_VERSION, rev: current.rev + 1, elements: applied.elements };
            const text = await writeDrawing(path, document);
            this.noteWritten(projectId, viewId, document.rev, text);
            this.emit(DRAWING_FILES.changed(projectId, viewId, document));
            return { rev: document.rev, added: applied.added, elements: document.elements.length };
        });
    }

    /* Every document that goes out to the clients passes here, so the changes are seen whoever made them. */
    protected override emit(event: SessionEvent, except: string | null = null): void {
        if (event.event === 'drawing.changed') {
            this.changes.note(changeKey(event.payload.projectId, event.payload.viewId), event.payload.document);
        }
        super.emit(event, except);
    }
}

/* What an edit left: the rev the drawing is at, the ids of the elements it added, and how many it holds. */
interface DrawingEdited {
    rev: number;
    added: string[];
    elements: number;
}

function changeKey(projectId: string, viewId: string): string {
    return `${projectId}\u0000${viewId}`;
}

function pathText(problem: DrawingEditProblem): string {
    return problem.path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? key : `${text}.${key}`), '');
}

function problemLine(problem: DrawingEditProblem): string {
    return `problem\t${pathText(problem) || 'edit'}\t${problem.message}`;
}
