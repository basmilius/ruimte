import type { StoreApi } from 'zustand';
import { runAsPerson } from '@/actions/client-actions';
import { diagramJsonPath } from '@/diagram/export';
import type { DiagramState } from '@/state/diagram';

/* What the diagram's dock, menus and palette rows do, as a person's actions on the diagram a store holds. */

type DiagramStore = Pick<StoreApi<DiagramState>, 'getState'>;

export function copyDiagram(store: DiagramStore, format: 'png' | 'svg' | 'json'): void {
    const viewId = store.getState().viewId;
    if (viewId !== null) {
        void runAsPerson('diagram.copy', { viewId, format });
    }
}

export function exportDiagram(store: DiagramStore, format: 'png' | 'svg'): void {
    const viewId = store.getState().viewId;
    if (viewId !== null) {
        void runAsPerson('diagram.export', { viewId, format });
    }
}

/* The file itself in the preview, which is where a person edits it by hand and the watcher takes it from there. */
export function openDiagramJson(viewId: string): void {
    const path = diagramJsonPath(viewId);
    if (path !== null) {
        void runAsPerson('file.preview', { path, line: null });
    }
}
