import { useSyncExternalStore } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { defaultCanvases, type CanvasNode } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { memoByIdentity } from '@/state/identity-memo';
import { viewIdsIn } from '@/shell/split';

/* What a sidebar row reads of a node. A drag or a resize changes none of it. */
export type SidebarCanvasNode = Pick<CanvasNode, 'id' | 'kind' | 'title' | 'titleSource' | 'provider' | 'status'>;

export interface SidebarSource {
    views: ProjectView[];
    activeViewId: string | null;
    openViewIds: string[];
    /* The nodes of every live canvas, in its order. */
    canvases: Record<string, SidebarCanvasNode[]>;
}

let cached: SidebarSource | null = null;

const project = (node: CanvasNode): SidebarCanvasNode => ({
    id: node.id,
    kind: node.kind,
    title: node.title,
    titleSource: node.titleSource,
    provider: node.provider,
    status: node.status
});

/* Every change of a canvas store asks again, a pan included; the order and the nodes are the same objects then. */
const projectCanvas = memoByIdentity((order: string[], nodes: Record<string, CanvasNode>): SidebarCanvasNode[] =>
    order.flatMap((id) => (nodes[id] ? [project(nodes[id])] : []))
);

const sameNode = (before: SidebarCanvasNode | undefined, next: SidebarCanvasNode): boolean =>
    before !== undefined &&
    before.id === next.id &&
    before.kind === next.kind &&
    before.title === next.title &&
    before.titleSource === next.titleSource &&
    before.provider === next.provider &&
    before.status === next.status;

const sameNodes = (before: SidebarCanvasNode[] | undefined, next: SidebarCanvasNode[]): boolean =>
    before === next || (before !== undefined && before.length === next.length && next.every((node, at) => sameNode(before[at], node)));

/* The camera, the selection, geometry and the save state change no sidebar row. */
export const sameSidebarSource = (before: SidebarSource, next: SidebarSource): boolean =>
    before.views === next.views &&
    before.activeViewId === next.activeViewId &&
    before.openViewIds.length === next.openViewIds.length &&
    before.openViewIds.every((id, at) => id === next.openViewIds[at]) &&
    Object.keys(before.canvases).length === Object.keys(next.canvases).length &&
    Object.entries(next.canvases).every(([id, nodes]) => sameNodes(before.canvases[id], nodes));

const build = (): SidebarSource => {
    const document = useDocument.getState();
    const canvases = Object.fromEntries(
        defaultCanvases.live().flatMap(([id, store]) => {
            const state = store.getState();
            return state.viewId === id ? [[id, projectCanvas(state.order, state.nodes)]] : [];
        })
    );
    const next: SidebarSource = {
        views: document.views,
        activeViewId: document.activeViewId,
        openViewIds: document.layout === null ? [] : viewIdsIn(document.layout),
        canvases
    };
    if (cached === null || !sameSidebarSource(cached, next)) {
        cached = next;
    }
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
