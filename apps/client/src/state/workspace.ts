import { createCanvasStore, defaultCanvases } from '@/state/canvas';
import { createDiagramStore, defaultDiagrams } from '@/state/diagram';
import { createDocumentStore, defaultDocumentStore } from '@/state/document';
import { createDrawingStore, defaultDrawings } from '@/state/drawing';
import { createEditorRegistry } from '@/state/editors';
import { createProjectStore, defaultProjectStore } from '@/state/project';
import type { WorkspaceStores } from '@/state/workspace-stores';

/*
 * A set of project stores of its own, made together because the document hands every view its editor
 * and reads back what those editors hold. The app uses the module's set below; a test makes one of
 * these when it wants to be left alone by the others.
 */
export const createWorkspaceStores = (): WorkspaceStores => {
    const canvases = createEditorRegistry(createCanvasStore);
    const drawings = createEditorRegistry(createDrawingStore);
    const diagrams = createEditorRegistry(createDiagramStore);
    return { canvases, drawings, diagrams, document: createDocumentStore({ canvases, drawings, diagrams }), project: createProjectStore() };
};

/*
 * The set every store module made on its own, which is the set of the window. A workspace fills it when
 * it opens and empties it when it goes, so a watcher that holds these never has to be told about another.
 */
export const defaultWorkspaceStores: WorkspaceStores = {
    canvases: defaultCanvases,
    document: defaultDocumentStore,
    drawings: defaultDrawings,
    diagrams: defaultDiagrams,
    project: defaultProjectStore
};
