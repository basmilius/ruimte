import { intersects, type Rect } from '@/canvas/math';
import type { PageHole } from '@/browser/page-clip';
import type { CanvasNodeKind } from '@ruimte/contracts';

/* What stacking needs of a node: where it stands and whether it is a group. */
export interface StackedNode extends Rect {
    kind: CanvasNodeKind;
}

/*
 * The z-index of every node, one apart and counting from one. A group paints under everything else
 * whatever its place in the order, since a group is a frame under its own nodes.
 */
export const stackingOrder = (nodes: Record<string, StackedNode>, order: string[]): Record<string, number> => {
    const groups = order.filter((id) => nodes[id]?.kind === 'group');
    const rest = order.filter((id) => nodes[id]?.kind !== 'group');
    return Object.fromEntries([...groups, ...rest].map((id, index) => [id, index + 1]));
};

/* The corner of a node frame (`rounded-xl` in `canvas/NodeFrame.tsx`). */
const NODE_RADIUS_PX = 12;

/* The ring a selected node draws just outside its frame (`.node-selected` in `styles.css`), which
   the hole leaves room for; without it the page cuts the ring in half. */
const RING_PX = 2;

/*
 * What stands on top of each browser node, in world units and shaped like the node that casts it. A
 * page is parked in a layer over the whole canvas and cannot be drawn under anything the canvas
 * draws, so the page cuts a hole for every node over it instead (`browser/page-clip.ts`).
 */
export const nodesOverBrowsers = (
    nodes: Record<string, StackedNode>,
    order: string[],
    hidden: ReadonlySet<string>,
    /* Nodes drawing a ring right now: the selection and whatever a line is being aimed at. */
    ringed: ReadonlySet<string>
): Record<string, PageHole[]> => {
    const stacking = stackingOrder(nodes, order);
    const over: Record<string, PageHole[]> = {};
    for (const id of order) {
        const node = nodes[id];
        if (node === undefined || node.kind !== 'browser' || hidden.has(id)) {
            continue;
        }
        const covering = order
            .filter((other) => other !== id && !hidden.has(other) && (stacking[other] ?? 0) > (stacking[id] ?? 0))
            .flatMap((other) => {
                const candidate = nodes[other];
                if (candidate === undefined || !intersects(node, candidate)) {
                    return [];
                }
                const grown = ringed.has(other) ? RING_PX : 0;
                return [
                    {
                        x: candidate.x - grown,
                        y: candidate.y - grown,
                        w: candidate.w + grown * 2,
                        h: candidate.h + grown * 2,
                        radius: NODE_RADIUS_PX + grown
                    }
                ];
            });
        if (covering.length > 0) {
            over[id] = covering;
        }
    }
    return over;
};
