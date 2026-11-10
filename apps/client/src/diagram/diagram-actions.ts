import type { StoreApi } from 'zustand';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { diagramJsonPath } from '@/diagram/export';
import type { DiagramState } from '@/state/diagram';

type DiagramStore = Pick<StoreApi<DiagramState>, 'getState'>;

export function copyDiagram(store: DiagramStore, format: 'png' | 'svg' | 'json'): void {
    const viewId = store.getState().viewId;
    if (viewId !== null) {
        void perform('diagram.copy', { viewId, format }).catch(ignoreRefusal);
    }
}

export function exportDiagram(store: DiagramStore, format: 'png' | 'svg'): void {
    const viewId = store.getState().viewId;
    if (viewId !== null) {
        void perform('diagram.export', { viewId, format }).catch(ignoreRefusal);
    }
}

/* The file itself in the preview, which is where a person edits it by hand and the watcher takes it from there. */
export function openDiagramJson(viewId: string): void {
    const path = diagramJsonPath(viewId);
    if (path !== null) {
        void perform('file.preview', { path, line: null }).catch(ignoreRefusal);
    }
}
