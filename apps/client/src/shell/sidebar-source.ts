import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { useSyncExternalStore } from 'react';
import { nodesOfView, type NodesOfView } from '@/project/view-nodes';
import { viewIdsIn } from '@/shell/split';
import { defaultCanvases, type CanvasNode } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { memoByIdentity } from '@/state/identity-memo';

/* What a sidebar row reads of a node. A drag or a resize changes none of it. */
export type SidebarCanvasNode = Pick<CanvasNode, 'id' | 'kind' | 'title' | 'titleSource' | 'provider' | 'status' | 'machine' | 'chats'>;

export interface SidebarSource {
    views: ProjectView[];
    activeViewId: string | null;
    openViewIds: string[];
    /* The nodes of every canvas view by its id, in its order, live where the canvas is on screen. */
    nodes: Record<string, readonly SidebarCanvasNode[]>;
    nodesOf: NodesOfView<SidebarCanvasNode>;
}

let cached: SidebarSource | null = null;

function project(node: CanvasNode): SidebarCanvasNode {
    return {
        id: node.id,
        kind: node.kind,
        title: node.title,
        titleSource: node.titleSource,
        provider: node.provider,
        status: node.status,
        machine: node.machine,
        chats: node.chats
    };
}

/* Every change of a canvas store asks again, a pan included; `nodesOfView` hands back the same list then. */
const rowNodes = memoByIdentity((nodes: readonly CanvasNode[]): readonly SidebarCanvasNode[] => nodes.map(project));

function sameNode(before: SidebarCanvasNode | undefined, next: SidebarCanvasNode): boolean {
    return (
        before !== undefined &&
        before.id === next.id &&
        before.kind === next.kind &&
        before.title === next.title &&
        before.titleSource === next.titleSource &&
        before.provider === next.provider &&
        before.status === next.status &&
        before.machine === next.machine &&
        before.chats === next.chats
    );
}

function sameNodes(before: readonly SidebarCanvasNode[] | undefined, next: readonly SidebarCanvasNode[]): boolean {
    return before === next || (before !== undefined && before.length === next.length && next.every((node, at) => sameNode(before[at], node)));
}

/* The camera, the selection, geometry and the save state change no sidebar row. */
export function sameSidebarSource(before: SidebarSource, next: SidebarSource): boolean {
    return (
        before.views === next.views &&
        before.activeViewId === next.activeViewId &&
        before.openViewIds.length === next.openViewIds.length &&
        before.openViewIds.every((id, at) => id === next.openViewIds[at]) &&
        Object.keys(before.nodes).length === Object.keys(next.nodes).length &&
        Object.entries(next.nodes).every(([id, nodes]) => sameNodes(before.nodes[id], nodes))
    );
}

function build(): SidebarSource {
    const document = useDocument.getState();
    const nodes = Object.fromEntries(document.views.flatMap((view) => (isCanvasView(view) ? [[view.id, rowNodes(nodesOfView(view))]] : [])));
    const next: SidebarSource = {
        views: document.views,
        activeViewId: document.activeViewId,
        openViewIds: document.layout === null ? [] : viewIdsIn(document.layout),
        nodes,
        nodesOf: (view) => nodes[view.id] ?? []
    };
    if (cached === null || !sameSidebarSource(cached, next)) {
        cached = next;
    }
    return cached;
}

function subscribe(listener: () => void): () => void {
    const offDocument = useDocument.subscribe(listener);
    const offCanvases = defaultCanvases.subscribe(listener);
    const offShape = defaultCanvases.subscribeShape(listener);
    return () => {
        offDocument();
        offCanvases();
        offShape();
    };
}

export function useSidebarSource(): SidebarSource {
    return useSyncExternalStore(subscribe, build);
}
