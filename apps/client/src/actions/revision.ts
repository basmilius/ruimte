import { ACTION_DEFINITIONS, ActionRefusal, REVISION_CONFLICT, revisionConflict, type ActionName, type ActionRevisionCheck } from '@ruimte/actions';
import type { StoreApi } from 'zustand';
import { defaultDiagrams } from '@/state/diagram';
import { defaultDrawings } from '@/state/drawing';
import { useProject } from '@/state/project';

/* What a store says of the file it holds: the rev it last saved or read, and whether it holds more than that. */
interface Held {
    rev: number;
    dirty: boolean;
}

/* The writes of this window whose document is the project file; a drawing and a diagram keep a file and a rev of their own. */
const PROJECT_DOMAINS: ReadonlySet<string> = new Set(['views', 'canvas', 'layout']);
const PROJECT_ACTIONS: ReadonlySet<ActionName> = new Set<ActionName>(['node.update', 'note.setColor', 'browser.navigate']);

const heldTo = (document: string, expected: number, { rev, dirty }: Held): void => {
    if (rev !== expected) {
        throw revisionConflict(document, expected, rev);
    }
    // An edit on screen that is not saved yet is a move the rev does not show.
    if (dirty) {
        throw new ActionRefusal(REVISION_CONFLICT, `${document} has changes on screen that are not saved yet; read it again in a moment and decide anew.`);
    }
};

const editorHeld = (kind: 'drawing' | 'diagram', viewId: unknown, peek: (viewId: string) => StoreApi<Held> | null): Held => {
    const store = typeof viewId === 'string' ? peek(viewId) : null;
    if (store === null) {
        throw new ActionRefusal('inactive-view', `Open the ${kind} before changing what it holds.`);
    }
    return store.getState();
};

/* A write in this window against the revision it was decided on, which a read here reports beside what it read. */
export const checkClientRevision: ActionRevisionCheck<void> = (name, input, call) => {
    const viewId = (input as { viewId?: unknown }).viewId;
    if (name.startsWith('drawing.')) {
        heldTo(
            'The drawing',
            call.expectedRevision,
            editorHeld('drawing', viewId, (id) => defaultDrawings.peek(id))
        );
        return;
    }
    if (name.startsWith('diagram.')) {
        heldTo(
            'The diagram',
            call.expectedRevision,
            editorHeld('diagram', viewId, (id) => defaultDiagrams.peek(id))
        );
        return;
    }
    if (PROJECT_DOMAINS.has(ACTION_DEFINITIONS[name].domain) || PROJECT_ACTIONS.has(name)) {
        heldTo('The project', call.expectedRevision, useProject.getState());
        return;
    }
    throw new ActionRefusal('no-revision', `“${name}” writes nothing with a revision this window reads, so it takes none.`);
};
