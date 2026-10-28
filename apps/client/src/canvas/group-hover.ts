import { containsPoint, type Point } from '@/canvas/math';
import type { StackedNode } from '@/canvas/stacking';

/*
 * The group a pointer at `point` is in: the topmost one whose frame holds it, so of two nested groups
 * the inner one. Read off the frame and not the DOM's hover, since the nodes in a group are its
 * siblings and a pointer over one of them is no longer over the group's element.
 */
export function hoveredGroup(nodes: Record<string, StackedNode>, order: readonly string[], hidden: ReadonlySet<string>, point: Point | null): string | null {
    if (point === null) {
        return null;
    }

    // Groups stack among themselves in the order given (`canvas/stacking.ts`), so the last one holding the point is on top.
    return (
        order.findLast((id) => {
            const node = nodes[id];
            return node?.kind === 'group' && !hidden.has(id) && containsPoint(node, point);
        }) ?? null
    );
}
