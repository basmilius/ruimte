import { isDeepStrictEqual } from 'node:util';
import { NODE_SIZE, isCanvasView, type PeerNode, type ProjectCanvasView, type ProjectNode, type ProjectView } from '@ruimte/contracts';

// The mirror is never looked at, so its nodes only need a place of their own and a size that holds.
const COLUMNS = 3;
const GAP = 40;

export function nodeOf(node: PeerNode, index: number): ProjectNode {
    const { w, h } = NODE_SIZE[node.kind];
    return { ...node, x: (index % COLUMNS) * (w + GAP), y: Math.floor(index / COLUMNS) * (h + GAP), w, h };
}

/* Whether a view or a node outside that machine's canvas has one of these ids, which would fail every flush of the other machine. */
export function idTakenOutside(views: readonly ProjectView[], canvasId: string, ids: ReadonlySet<string>): boolean {
    return views.some((view) => view.id !== canvasId && (ids.has(view.id) || (isCanvasView(view) && view.nodes.some((node) => ids.has(node.id)))));
}

/* Hidden is laid over the document and is no part of what the other machine drew. */
export function sameCanvas(held: ProjectView, next: ProjectCanvasView): boolean {
    return isDeepStrictEqual(stripHidden(held as ProjectCanvasView), next);
}

export function stripHidden(canvas: ProjectCanvasView): ProjectCanvasView {
    const { hidden: _hidden, ...rest } = canvas;
    return rest;
}
