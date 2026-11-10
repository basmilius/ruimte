import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { useSyncExternalStore } from 'react';
import { viewIdsIn } from '@/layout/split';
import { defaultCanvases, type CanvasNode } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { memoByIdentity } from '@/state/identity-memo';
import { nodesOfView, type NodesOfView } from '@/state/view-nodes';

/* What a reader of the project's rows takes of a node: its chrome and who it talks to. A drag or a resize changes none of it. */
const ROW_FIELDS = ['id', 'kind', 'title', 'titleSource', 'provider', 'status', 'machine', 'chats'] as const satisfies readonly (keyof CanvasNode)[];

export type ProjectSourceNode = Pick<CanvasNode, (typeof ROW_FIELDS)[number]>;

export interface ProjectSource {
    views: ProjectView[];
    activeViewId: string | null;
    openViewIds: string[];
    nodes: Record<string, readonly ProjectSourceNode[]>;
    nodesOf: NodesOfView<ProjectSourceNode>;
}

let cached: ProjectSource | null = null;

function project(node: CanvasNode): ProjectSourceNode {
    // The type is the list's own, so a field added to `ROW_FIELDS` is copied here and compared below.
    return Object.fromEntries(ROW_FIELDS.map((field) => [field, node[field]])) as ProjectSourceNode;
}

/* Every change of a canvas store asks again, a pan included; `nodesOfView` hands back the same list then. */
const rowNodes = memoByIdentity((nodes: readonly CanvasNode[]): readonly ProjectSourceNode[] => nodes.map(project));

function sameNode(before: ProjectSourceNode | undefined, next: ProjectSourceNode): boolean {
    return before !== undefined && ROW_FIELDS.every((field) => before[field] === next[field]);
}

function sameNodes(before: readonly ProjectSourceNode[] | undefined, next: readonly ProjectSourceNode[]): boolean {
    return before === next || (before !== undefined && before.length === next.length && next.every((node, at) => sameNode(before[at], node)));
}

/* The camera, the selection, geometry and the save state change no sidebar row. */
export function sameProjectSource(before: ProjectSource, next: ProjectSource): boolean {
    return (
        before.views === next.views &&
        before.activeViewId === next.activeViewId &&
        before.openViewIds.length === next.openViewIds.length &&
        before.openViewIds.every((id, at) => id === next.openViewIds[at]) &&
        Object.keys(before.nodes).length === Object.keys(next.nodes).length &&
        Object.entries(next.nodes).every(([id, nodes]) => sameNodes(before.nodes[id], nodes))
    );
}

function build(): ProjectSource {
    const document = useDocument.getState();
    const nodes = Object.fromEntries(document.views.flatMap((view) => (isCanvasView(view) ? [[view.id, rowNodes(nodesOfView(view))]] : [])));
    const next: ProjectSource = {
        views: document.views,
        activeViewId: document.activeViewId,
        openViewIds: document.layout === null ? [] : viewIdsIn(document.layout),
        nodes,
        nodesOf: (view) => nodes[view.id] ?? []
    };
    if (cached === null || !sameProjectSource(cached, next)) {
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

export function useProjectSource(): ProjectSource {
    return useSyncExternalStore(subscribe, build);
}
