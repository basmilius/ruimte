import { describe, expect, test } from 'bun:test';
import { NODE_GAP, portPoint, routeDraft, routeEdge, selfRoute, type Obstacle } from './edge-route';

const box = { x: 0, y: 0, w: 100, h: 100 };
const at = (x: number, y: number): Obstacle => ({ id: `n-${x}-${y}`, x, y, w: 100, h: 100 });

/* The turning points of a route, which is what the rounded corners are drawn between. */
const turns = (d: string): [number, number][] => [...d.matchAll(/Q (-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);

describe('the sides a line runs between', () => {
    const sides = (b: { x: number; y: number; w: number; h: number }, obstacles: Obstacle[] = []): string[] => {
        const route = routeEdge(box, b, obstacles);
        return [route.fromSide, route.toSide];
    };

    test('face each other, so the line takes the short way round', () => {
        expect(sides({ x: 300, y: 0, w: 100, h: 100 })).toEqual(['right', 'left']);
        expect(sides({ x: -300, y: 0, w: 100, h: 100 })).toEqual(['left', 'right']);
        expect(sides({ x: 0, y: 300, w: 100, h: 100 })).toEqual(['bottom', 'top']);
        expect(sides({ x: 0, y: -300, w: 100, h: 100 })).toEqual(['top', 'bottom']);
    });

    test('give way to another pair when a row of nodes stands between the facing ones', () => {
        // Tall nodes beside one another, the way a row of chats stands on a canvas.
        const row: Obstacle[] = [
            { id: 'first', x: 200, y: 0, w: 300, h: 1000 },
            { id: 'second', x: 600, y: 0, w: 300, h: 1000 }
        ];
        const source = { x: 0, y: 400, w: 100, h: 200 };
        // Straight across is clear, so the node beside the source keeps the sides the two face.
        const near = routeEdge(source, row[0]!, row.slice(1));
        expect([near.fromSide, near.toSide]).toEqual(['right', 'left']);
        // The one behind it is reached over the row, and lands on the side the line comes down on.
        const far = routeEdge(source, { x: 1000, y: 0, w: 300, h: 1000 }, row);
        expect(far.fromSide).toBe('bottom');
        expect(far.toSide).toBe('bottom');
    });

    test('put the port a gap out from the node, never on its border', () => {
        expect(portPoint(box, 'right')).toEqual({ x: 100 + NODE_GAP, y: 50 });
        expect(portPoint(box, 'top')).toEqual({ x: 50, y: -NODE_GAP });
    });
});

describe('the route between two nodes', () => {
    test('starts and ends on the ports, a gap clear of both nodes', () => {
        const route = routeEdge(box, { x: 300, y: 0, w: 100, h: 100 });
        expect(route.from).toEqual({ x: 109, y: 50 });
        expect(route.to).toEqual({ x: 291, y: 50 });
        expect(route.d).toStartWith('M 109 50');
        expect(route.d).toEndWith('L 291 50');
    });

    test('runs straight when the ports line up, and turns twice when they do not', () => {
        expect(turns(routeEdge(box, { x: 300, y: 0, w: 100, h: 100 }).d)).toEqual([]);
        const stepped = routeEdge(box, { x: 300, y: 200, w: 100, h: 100 });
        expect(turns(stepped.d)).toEqual([
            [200, 50],
            [200, 250]
        ]);
    });

    test('slides its rail off the middle to keep clear of a node in the way', () => {
        const straight = routeEdge(box, { x: 400, y: 200, w: 100, h: 100 });
        const around = routeEdge(box, { x: 400, y: 200, w: 100, h: 100 }, [at(180, 0)]);
        expect(turns(straight.d)[0]![0]).toBe(250);
        // The rail moves to the near side of the node in the way, one margin clear of it.
        expect(turns(around.d)[0]![0]).toBe(168);
    });

    test('steps aside when a node blocks the straight shot between two ports that line up', () => {
        const route = routeEdge(box, { x: 400, y: 0, w: 100, h: 100 }, [at(200, 0)]);
        // Out of the port, up beside it, across above the node and back down: four turns, no diagonal.
        expect(turns(route.d)).toEqual([
            [133, 50],
            [133, -12],
            [367, -12],
            [367, 50]
        ]);
    });

    test('a line onto its own node loops beside it', () => {
        const route = selfRoute(box);
        expect(route.from).toEqual({ x: 109, y: 75 });
        expect(route.to).toEqual({ x: 109, y: 25 });
        expect(route.mid.x).toBeGreaterThan(109);
    });

    test('a line being drawn ends under the pointer, with no gap there', () => {
        const route = routeDraft(box, { x: 400, y: 50 });
        expect(route.from).toEqual({ x: 109, y: 50 });
        expect(route.to).toEqual({ x: 400, y: 50 });
    });
});

describe('the middle of a route', () => {
    test('is halfway along the line, not between its ends', () => {
        // Down, across and down again: the middle rides the leg it falls on, not the line between the ends.
        const route = routeEdge(box, { x: 60, y: 300, w: 100, h: 100 });
        expect(turns(route.d)).toEqual([
            [50, 200],
            [110, 200]
        ]);
        expect(route.mid).toEqual({ x: 80, y: 200 });
    });
});

describe('a route that the rail cannot clear', () => {
    /* The corners of a route: where it starts, every point it turns on, and where it ends. */
    const corners = (d: string): { x: number; y: number }[] => {
        const start = /^M (-?[\d.]+) (-?[\d.]+)/.exec(d)!;
        const end = /L (-?[\d.]+) (-?[\d.]+)$/.exec(d)!;
        return [{ x: Number(start[1]), y: Number(start[2]) }, ...turns(d).map(([x, y]) => ({ x, y })), { x: Number(end[1]), y: Number(end[2]) }];
    };

    /* Whether any leg runs through the node itself, which is what a route may never do. */
    const runsThrough = (d: string, node: Obstacle): boolean =>
        corners(d)
            .slice(1)
            .some((point, index) => {
                const previous = corners(d)[index]!;
                return (
                    Math.min(previous.x, point.x) < node.x + node.w &&
                    Math.max(previous.x, point.x) > node.x &&
                    Math.min(previous.y, point.y) < node.y + node.h &&
                    Math.max(previous.y, point.y) > node.y
                );
            });

    test('goes looking for a way around, and finds one that touches nothing', () => {
        // One node straight between the two ends, and a second one across the way the rail would slide.
        const between = at(300, 0);
        const above = { id: 'above', x: 200, y: -100, w: 300, h: 100 };
        const target = { x: 600, y: 0, w: 100, h: 100 };
        const route = routeEdge(box, target, [between, above]);
        expect(runsThrough(route.d, between)).toBe(false);
        expect(runsThrough(route.d, above)).toBe(false);
        // Both ends still sit on a port of their own node, wherever the way around took the line.
        expect(route.from).toEqual(portPoint(box, route.fromSide));
        expect(route.to).toEqual(portPoint(target, route.toSide));
    });

    test('falls back on the plain channel when a node is walled in', () => {
        const wall: Obstacle[] = [
            { id: 'n', x: 500, y: -200, w: 400, h: 200 },
            { id: 'e', x: 800, y: -200, w: 100, h: 600 },
            { id: 's', x: 500, y: 300, w: 400, h: 100 },
            { id: 'w', x: 480, y: -200, w: 20, h: 600 }
        ];
        const route = routeEdge(box, { x: 600, y: 0, w: 100, h: 100 }, wall);
        // Nothing to find, so it draws the line it would have drawn and tucks in behind the nodes.
        expect(route.d).toStartWith('M 109 50');
        expect(route.d).toEndWith('L 591 50');
    });
});

describe('a gap between two nodes', () => {
    test('is not threaded when there is a way round', () => {
        // Two nodes a hair apart, with the target behind the pair of them.
        const left: Obstacle = { id: 'left', x: 200, y: 0, w: 200, h: 600 };
        const right: Obstacle = { id: 'right', x: 430, y: 0, w: 200, h: 600 };
        const route = routeEdge({ x: 0, y: 250, w: 100, h: 100 }, { x: 700, y: 250, w: 100, h: 100 }, [left, right]);
        // The 30 units between the two nodes would fit a line; it goes round them instead.
        expect(turns(route.d).every(([x]) => x < 400 || x > 430)).toBe(true);
    });
});

describe('the step a route makes', () => {
    test('is never smaller than the piece a line keeps straight', () => {
        /* Nodes of the same height in a row: the way over them runs a margin above their tops, which
           is a hair above the ports on those tops. The rail steps clear of that instead. */
        const row: Obstacle[] = [
            { id: 'first', x: 400, y: 0, w: 300, h: 600 },
            { id: 'second', x: 800, y: 0, w: 300, h: 600 }
        ];
        const route = routeEdge({ x: 0, y: 0, w: 300, h: 600 }, { x: 1200, y: 0, w: 300, h: 600 }, row);
        const steps = turns(route.d).map(([, y]) => Math.abs(y - route.from.y));
        expect(Math.min(...steps.filter((step) => step > 0))).toBeGreaterThanOrEqual(24);
    });
});

describe('a port a person drew from', () => {
    const target = { x: 600, y: 0, w: 100, h: 100 };

    test('is the side that end keeps, wherever the two nodes lie', () => {
        // Straight to the right, so the line would leave the right side of its own accord.
        expect(routeEdge(box, target).fromSide).toBe('right');
        const held = routeEdge(box, target, [], { fromSide: 'top' });
        expect(held.fromSide).toBe('top');
        expect(held.from).toEqual(portPoint(box, 'top'));
        // The end nobody drew from stays free: a line leaving over the top comes in over the top.
        expect(held.toSide).toBe('top');
    });

    test('holds both ends when both were named', () => {
        const held = routeEdge(box, target, [], { fromSide: 'bottom', toSide: 'bottom' });
        expect([held.fromSide, held.toSide]).toEqual(['bottom', 'bottom']);
        expect(held.to).toEqual(portPoint(target, 'bottom'));
    });
});

describe('a line leaving the bottom of a node', () => {
    /* The first point a route turns on, which is where the piece it keeps straight out of the port ends. */
    const firstTurn = (d: string): [number, number] => turns(d)[0]!;

    test('goes out past its stub before it turns, while it is being drawn beside the node', () => {
        // The pointer sits to the right of the node and above its bottom, where a rail would run under it.
        const route = routeDraft(box, { x: 130, y: 80 }, [], { fromSide: 'bottom' });
        expect(route.from).toEqual(portPoint(box, 'bottom'));
        expect(route.to).toEqual({ x: 130, y: 80 });
        expect(firstTurn(route.d)[1]).toBeGreaterThanOrEqual(box.h + NODE_GAP + 24);
    });

    test('does not turn inside its stub toward a node just below it', () => {
        const route = routeEdge(box, { x: 300, y: 70, w: 100, h: 100 }, [], { fromSide: 'bottom' });
        expect(firstTurn(route.d)[1]).toBeGreaterThanOrEqual(box.h + NODE_GAP + 24);
    });

    test('runs straight to a pointer just out from the port, closer than its stub', () => {
        const route = routeDraft(box, { x: 50, y: -20 }, [], { fromSide: 'top' });
        expect(route.d).toBe('M 50 -9 L 50 -20');
    });

    test('stops at the edge of the gap around its own node while the pointer is over it', () => {
        const route = routeDraft(box, { x: 104, y: 60 }, [], { fromSide: 'bottom' });
        expect(route.to).toEqual({ x: 109, y: 60 });
        expect(firstTurn(route.d)[1]).toBeGreaterThanOrEqual(box.h + NODE_GAP + 24);
    });

    test('lands on a node under the pointer instead of going round it', () => {
        const target = at(300, 0);
        const route = routeDraft(box, { x: 350, y: 50 }, [target], { fromSide: 'right' });
        expect(turns(route.d)).toEqual([]);
    });
});
