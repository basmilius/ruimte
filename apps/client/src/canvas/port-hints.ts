import { portPoint, routeEdge, type Obstacle, type Side } from '@/canvas/edge-route';
import type { Point, Rect } from '@/canvas/math';

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

export const portKey = (nodeId: string, side: Side): string => `${nodeId}:${side}`;

/* How far a port has come for a pointer this near: 0 where it starts to show, 1 close enough to aim
   at, and the half of the reach nearest the port is where it is all the way in. */
export const hintStrength = (distance: number, reach: number): number => Math.min(1, Math.max(0, (reach - distance) / (reach / 2)));

/*
 * The ports to show for a pointer at `point`: the nearest side of every node within reach, one per
 * node, so walking along a row of nodes lights one dot at a time. A side a line already leaves from
 * is offered too, or the line there would be the only thing a press could land on.
 */
export const portHints = (nodes: readonly (Rect & { id: string })[], point: Point, reach: number): PortHint[] => {
    const hints: PortHint[] = [];
    for (const node of nodes) {
        let nearest: PortHint | null = null;
        for (const side of SIDES) {
            const at = portPoint(node, side);
            const distance = Math.hypot(at.x - point.x, at.y - point.y);
            if (distance > reach || (nearest !== null && distance >= nearest.distance)) {
                continue;
            }
            nearest = { nodeId: node.id, side, at, distance, strength: hintStrength(distance, reach) };
        }
        if (nearest !== null) {
            hints.push(nearest);
        }
    }
    return hints;
};

/*
 * The sides a line already leaves from or lands on, which is where a node draws no dot of its own.
 * The route decides that, so this walks the same routes the canvas draws.
 */
export const takenPorts = (
    edges: readonly { from: string; to: string; fromSide?: Side; toSide?: Side }[],
    rectOf: (id: string) => Rect | null,
    obstacles: readonly Obstacle[] = []
): Set<string> => {
    const taken = new Set<string>();
    for (const edge of edges) {
        const from = rectOf(edge.from);
        const to = rectOf(edge.to);
        if (from === null || to === null) {
            continue;
        }
        if (edge.from === edge.to) {
            // A loop onto the same node leaves and comes back on the right.
            taken.add(portKey(edge.from, 'right'));
            continue;
        }
        const route = routeEdge(
            from,
            to,
            obstacles.filter((obstacle) => obstacle.id !== edge.from && obstacle.id !== edge.to),
            { fromSide: edge.fromSide, toSide: edge.toSide }
        );
        taken.add(portKey(edge.from, route.fromSide));
        taken.add(portKey(edge.to, route.toSide));
    }
    return taken;
};
