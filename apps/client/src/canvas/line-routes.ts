import type { CanvasNode, Edge, TextElement } from '@/state/canvas';
import { edgeLines, fixedSides, textRect, type EdgeLine } from '@/canvas/edge-lines';
import { routeEdge, selfRoute, type EdgeRoute, type Obstacle } from '@/canvas/edge-route';
import type { Rect } from '@/canvas/math';
import { memoByIdentity } from '@/state/identity-memo';

export interface LineRoutes {
    lines: EdgeLine[];
    /* Groups are left out, since a group is a frame under its nodes and a line between two of them
       would be pushed out of it. */
    obstacles: Obstacle[];
    /* By the id of the edge a line is drawn from; a line with a hidden end has none. */
    routes: Map<string, EdgeRoute>;
    rectOf(id: string): Rect | null;
}

/* What a line was drawn with last time: the line, its route and everything that route was found from. */
interface Kept {
    line: EdgeLine;
    route: EdgeRoute;
    field: string;
    ends: string;
}

/* By the edge a line is drawn from, and gone with it. A canvas that takes a node's title or body in keeps every line as it was. */
const kept = new WeakMap<Edge, Kept>();

function rectKey({ x, y, w, h }: Rect): string {
    return `${x},${y},${w},${h}`;
}

/* The same line as last time when nothing it says changed, so a row that draws it is handed what it had. */
function keptLine(line: EdgeLine, before: EdgeLine | undefined): EdgeLine {
    return before !== undefined && before.back === line.back && before.label === line.label ? before : line;
}

/*
 * A blocked route is a search over a grid, so the routes are found again only when a line or what it
 * passes changes, never for a pan or a zoom. A route depends on the geometry of every node and on
 * nothing else, so one is only searched for when that geometry moved; a route that comes out the
 * same is handed back as the object it was.
 */
export const lineRoutes = memoByIdentity(
    (edges: Edge[], nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>, hidden: Set<string>): LineRoutes => {
        const rectOf = (id: string): Rect | null => (hidden.has(id) ? null : nodes[id] ? nodes[id] : texts[id] ? textRect(texts[id]) : null);
        const obstacles = Object.values(nodes)
            .filter((node) => node.kind !== 'group' && !hidden.has(node.id))
            .map(({ id, x, y, w, h }): Obstacle => ({ id, x, y, w, h }));
        const field = obstacles.map((obstacle) => `${obstacle.id}:${rectKey(obstacle)}`).join(';');
        const lines: EdgeLine[] = [];
        const routes = new Map<string, EdgeRoute>();
        for (const fresh of edgeLines(edges)) {
            const before = kept.get(fresh.edge);
            const line = keptLine(fresh, before?.line);
            lines.push(line);
            const a = rectOf(line.edge.from);
            const b = rectOf(line.edge.to);
            if (!a || !b) {
                continue;
            }
            const sides = fixedSides(line);
            const ends = `${line.edge.from}:${rectKey(a)}|${line.edge.to}:${rectKey(b)}|${sides.fromSide ?? ''}|${sides.toSide ?? ''}`;
            let route: EdgeRoute;
            if (before !== undefined && before.field === field && before.ends === ends) {
                route = before.route;
            } else {
                const found =
                    line.edge.from === line.edge.to
                        ? selfRoute(a)
                        : routeEdge(
                              a,
                              b,
                              obstacles.filter((obstacle) => obstacle.id !== line.edge.from && obstacle.id !== line.edge.to),
                              sides
                          );
                route = before !== undefined && sameRoute(before.route, found) ? before.route : found;
            }
            routes.set(line.edge.id, route);
            kept.set(line.edge, { line, route, field, ends });
        }
        return { lines, obstacles, routes, rectOf };
    }
);

function sameRoute(one: EdgeRoute, other: EdgeRoute): boolean {
    return one.d === other.d && one.fromSide === other.fromSide && one.toSide === other.toSide;
}
