import { groupMemberIds, type CanvasNodeKind, type GroupFrame } from '@ruimte/contracts';
import { intersects, type Rect } from '@/canvas-model/math';
import type { PageHole } from '@/canvas-model/page-clip';

/* What stacking needs of a node: where it stands, whether it is a group and what a group holds. */
export interface StackedNode extends Rect, Pick<GroupFrame, 'collapsed' | 'memberIds' | 'expandedHeight'> {
    kind: CanvasNodeKind;
}

/*
 * The groups of `order` in it, each after every group that holds it: its frame would otherwise lie
 * over the bar of the group inside it and take the presses meant for that bar.
 */
function groupsInOrder(nodes: Record<string, StackedNode>, order: string[]): string[] {
    const groupIds = order.filter((id) => nodes[id]?.kind === 'group');

    if (groupIds.length < 2) {
        return groupIds;
    }

    const frames = [...new Set(groupIds)].map((id) => ({ ...nodes[id]!, id }));
    const holders = new Map<string, string[]>();

    for (const frame of frames) {
        for (const member of groupMemberIds(frame, frames)) {
            holders.set(member, [...(holders.get(member) ?? []), frame.id]);
        }
    }

    const depths = new Map<string, number>();

    // A cycle a hand-edited file holds counts its repeat as no holder.
    const depthOf = (id: string, seen: ReadonlySet<string>): number => {
        const known = depths.get(id);

        if (known !== undefined) {
            return known;
        }

        const around = (holders.get(id) ?? []).filter((holder) => !seen.has(holder));
        const depth = Math.max(0, ...around.map((holder) => depthOf(holder, new Set([...seen, id])) + 1));
        depths.set(id, depth);

        return depth;
    };

    return groupIds
        .map((id, index) => ({ id, index, depth: depthOf(id, new Set()) }))
        .sort((first, second) => first.depth - second.depth || first.index - second.index)
        .map((entry) => entry.id);
}

/*
 * The z-index of every node, one apart and counting from one. A group paints under everything else
 * whatever its place in the order, since a group is a frame under its own nodes, and over the groups
 * that hold it.
 */
export function stackingOrder(nodes: Record<string, StackedNode>, order: string[]): Record<string, number> {
    const groups = groupsInOrder(nodes, order);
    const rest = order.filter((id) => nodes[id]?.kind !== 'group');

    // Chrome builds large records faster through Object.fromEntries; short orders avoid its temporary arrays.
    if (order.length >= 256) {
        return Object.fromEntries([...groups, ...rest].map((id, index) => [id, index + 1]));
    }

    const stacking: Record<string, number> = {};
    let next = 1;

    for (const ids of [groups, rest]) {
        for (const id of ids) {
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
