import { createCanvasStore, defaultCanvasStore } from '@/state/canvas';
import { createDocumentStore, defaultDocumentStore } from '@/state/document';
import { createDrawingStore, defaultDrawingStore } from '@/state/drawing';
import { createProjectStore, defaultProjectStore } from '@/state/project';
import type { WorkspaceStores } from '@/state/workspace-stores';

/*
 * The four stores of one open project, made together because the document hands its views to the
 * canvas and reads a drawing's camera: peers of one workspace, never of the workspace next to it.
 */
export const createWorkspaceStores = (): WorkspaceStores => {
    const canvas = createCanvasStore();
    const drawing = createDrawingStore();
    return { canvas, drawing, document: createDocumentStore({ canvas, drawing }), project: createProjectStore() };
};

/*
 * The set every store module made on its own. The first workspace takes these rather than fresh
 * ones, so a component that sits outside every provider (a dialog, a toast) still reads the project
 * the app started with instead of an empty store nothing writes to.
 */
export const defaultWorkspaceStores: WorkspaceStores = {
    canvas: defaultCanvasStore,
    document: defaultDocumentStore,
    drawing: defaultDrawingStore,
    project: defaultProjectStore
};
