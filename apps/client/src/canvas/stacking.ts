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
export function stackingOrder(nodes: Record<string, StackedNode>, order: string[]): Record<string, number> {
    // Chrome builds large records faster through Object.fromEntries; short orders avoid its temporary arrays.
    if (order.length >= 256) {
        const groups = order.filter((id) => nodes[id]?.kind === 'group');
        const rest = order.filter((id) => nodes[id]?.kind !== 'group');

        return Object.fromEntries([...groups, ...rest].map((id, index) => [id, index + 1]));
    }

    const stacking: Record<string, number> = {};
    let next = 1;

    for (const groups of [true, false]) {
        for (const id of order) {
            if ((nodes[id]?.kind === 'group') !== groups) {
                continue;
            }

            // A stored id is an own property, as it was with Object.fromEntries.
            if (id === '__proto__') {
                Object.defineProperty(stacking, id, { value: next, enumerable: true, configurable: true, writable: true });
            } else {
                stacking[id] = next;
            }

            next++;
        }
    }

    return stacking;
}

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
export function nodesOverBrowsers(
    nodes: Record<string, StackedNode>,
    order: string[],
    hidden: ReadonlySet<string>,
    /* Nodes drawing a ring right now: the selection and whatever a line is being aimed at. */
    ringed: ReadonlySet<string>
): Record<string, PageHole[]> {
    const browsers = order.filter((id) => nodes[id]?.kind === 'browser' && !hidden.has(id));

    if (browsers.length === 0) {
        return {};
    }

    const stacking = stackingOrder(nodes, order);
    const over: Record<string, PageHole[]> = {};
    for (const id of browsers) {
        const node = nodes[id]!;
        const level = stacking[id] ?? 0;
        const covering = order
            .filter((other) => other !== id && !hidden.has(other) && (stacking[other] ?? 0) > level)
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
}
