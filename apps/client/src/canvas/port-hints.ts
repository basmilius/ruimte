import { portPoint, type Side } from '@/canvas/edge-route';
import type { LineRoutes } from '@/canvas/line-routes';
import type { Point, Rect } from '@/canvas/math';
import { memoByIdentity } from '@/state/identity-memo';

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/* How far from a port a pointer starts to see it, in screen pixels: a port is a thing you walk up to. */
export const HINT_REACH = 56;

/* Within this much of a port the pointer is on it, which is what the accent says. */
export const HINT_HOT = 14;

/* A port offered to the pointer: a side of a node no line leaves from yet. */
export interface PortHint {
    nodeId: string;
    side: Side;
    at: Point;
    distance: number;
    /* 0 where it fades in, 1 with the pointer close enough to aim at it. */
    strength: number;
}

export function portKey(nodeId: string, side: Side): string {
    return `${nodeId}:${side}`;
}

/*
 * The ports to show for a pointer at `point`: the nearest side of every node within reach, one per
 * node, so walking along a row of nodes lights one dot at a time. A side a line already leaves from
 * is offered too, or the line there would be the only thing a press could land on.
 */
export function portHints(nodes: readonly (Rect & { id: string })[], point: Point, reach: number): PortHint[] {
    const hints: PortHint[] = [];
    for (const node of nodes) {
        let nearest: PortHint | null = null;
        for (const side of SIDES) {
            const at = portPoint(node, side);
            const distance = Math.hypot(at.x - point.x, at.y - point.y);
            if (distance > reach || (nearest !== null && distance >= nearest.distance)) {
                continue;
            }
            nearest = { nodeId: node.id, side, at, distance, strength: Math.min(1, (reach - distance) / (reach / 2)) };
        }
        if (nearest !== null) {
            hints.push(nearest);
        }
    }
    return hints;
}

/*
 * The sides a line already leaves from or lands on, which is where a node draws no dot of its own.
 * Read off the routes the canvas draws, so a pointer walking over it routes nothing.
 */
export const takenPorts = memoByIdentity((drawn: Pick<LineRoutes, 'lines' | 'routes'>): ReadonlySet<string> => {
    const taken = new Set<string>();
    for (const line of drawn.lines) {
        const route = drawn.routes.get(line.edge.id);
        if (route !== undefined) {
            taken.add(portKey(line.edge.from, route.fromSide));
            taken.add(portKey(line.edge.to, route.toSide));
        }
    }
    return taken;
});
