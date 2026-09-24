import type { CanvasNode, Edge, TextElement } from '@/state/canvas';
import { edgeLines, fixedSides, textRect, type EdgeLine } from '@/canvas/edge-lines';
import { routeEdge, selfRoute, type EdgeRoute, type Obstacle } from '@/canvas/edge-route';
import type { Rect } from '@/canvas/math';
import { memoByIdentity } from '@/state/identity-memo';

export interface LineRoutes {
    lines: EdgeLine[];
    /* What a line routes around. A group is a frame under its nodes, so a line between two of them
       would be pushed out of the group it belongs to. */
    obstacles: Obstacle[];
    /* By the id of the edge a line is drawn from; a line with a hidden end has none. */
    routes: Map<string, EdgeRoute>;
    rectOf(id: string): Rect | null;
}

/* A blocked route is a search over a grid, so the routes are found again only when a line or what it
   passes changes, never for a pan or a zoom. */
export const lineRoutes = memoByIdentity(
    (edges: Edge[], nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>, hidden: Set<string>): LineRoutes => {
        const rectOf = (id: string): Rect | null => (hidden.has(id) ? null : nodes[id] ? nodes[id] : texts[id] ? textRect(texts[id]) : null);
        const obstacles = Object.values(nodes)
            .filter((node) => node.kind !== 'group' && !hidden.has(node.id))
            .map(({ id, x, y, w, h }): Obstacle => ({ id, x, y, w, h }));
        const lines = edgeLines(edges);
        const routes = new Map<string, EdgeRoute>();
        for (const line of lines) {
            const a = rectOf(line.edge.from);
            const b = rectOf(line.edge.to);
            if (!a || !b) {
                continue;
            }
            routes.set(
                line.edge.id,
                line.edge.from === line.edge.to
                    ? selfRoute(a)
                    : routeEdge(
                          a,
                          b,
                          obstacles.filter((obstacle) => obstacle.id !== line.edge.from && obstacle.id !== line.edge.to),
                          fixedSides(line)
                      )
            );
        }
        return { lines, obstacles, routes, rectOf };
    }
);
