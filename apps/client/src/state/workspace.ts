import { createCanvasStore, defaultCanvases } from '@/state/canvas';
import { createDiagramStore, defaultDiagrams } from '@/state/diagram';
import { createDocumentStore, defaultDocumentStore } from '@/state/document';
import { createDrawingStore, defaultDrawings } from '@/state/drawing';
import { createEditorRegistry } from '@/state/editors';
import { createProjectStore, defaultProjectStore } from '@/state/project';
import type { WorkspaceStores } from '@/state/workspace-stores';

/*
 * The stores of one open project, made together because the document hands every view its editor and
 * reads back what those editors hold: peers of one workspace, never of the workspace next to it.
 */
export const createWorkspaceStores = (): WorkspaceStores => {
    const canvases = createEditorRegistry(createCanvasStore);
    const drawings = createEditorRegistry(createDrawingStore);
    const diagrams = createEditorRegistry(createDiagramStore);
    return { canvases, drawings, diagrams, document: createDocumentStore({ canvases, drawings, diagrams }), project: createProjectStore() };
};

/*
 * The set every store module made on its own. The first workspace takes these rather than fresh
 * ones, so a component that sits outside every provider (a dialog, a toast) still reads the project
 * the app started with instead of an empty store nothing writes to.
 */
export const defaultWorkspaceStores: WorkspaceStores = {
    canvases: defaultCanvases,
    document: defaultDocumentStore,
    drawings: defaultDrawings,
    diagrams: defaultDiagrams,
    project: defaultProjectStore
};
