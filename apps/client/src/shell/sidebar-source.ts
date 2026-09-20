import { useSyncExternalStore } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { defaultCanvases, type CanvasNode } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { viewIdsIn } from '@/shell/split';

interface SidebarCanvas {
    order: string[];
    nodes: Record<string, CanvasNode>;
}

export interface SidebarSource {
    views: ProjectView[];
    activeViewId: string | null;
    openViewIds: string[];
    canvases: Record<string, SidebarCanvas>;
}

let cached: SidebarSource | null = null;

// Camera, selection and save-state changes do not change any sidebar rows.
const same = (before: SidebarSource, next: SidebarSource): boolean =>
    before.views === next.views &&
    before.activeViewId === next.activeViewId &&
    before.openViewIds.length === next.openViewIds.length &&
    before.openViewIds.every((id, at) => id === next.openViewIds[at]) &&
    Object.keys(before.canvases).length === Object.keys(next.canvases).length &&
    Object.entries(next.canvases).every(([id, canvas]) => before.canvases[id]?.nodes === canvas.nodes && before.canvases[id]?.order === canvas.order);

const build = (): SidebarSource => {
    const document = useDocument.getState();
    const canvases = Object.fromEntries(
        defaultCanvases.live().flatMap(([id, store]) => {
            const state = store.getState();
            return state.viewId === id ? [[id, { order: state.order, nodes: state.nodes }]] : [];
        })
    );
    const next: SidebarSource = {
        views: document.views,
        activeViewId: document.activeViewId,
        openViewIds: document.layout === null ? [] : viewIdsIn(document.layout),
        canvases
    };
    if (cached === null || !same(cached, next)) cached = next;
    return cached;
};

const subscribe = (listener: () => void): (() => void) => {
    const offDocument = useDocument.subscribe(listener);
    const offCanvases = defaultCanvases.subscribe(listener);
    const offShape = defaultCanvases.subscribeShape(listener);
    return () => {
        offDocument();
        offCanvases();
        offShape();
    };
};

export const useSidebarSource = (): SidebarSource => useSyncExternalStore(subscribe, build);
