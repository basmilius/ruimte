import type { FixedSides } from '@/canvas-model/fixed-sides';
import type { Obstacle } from '../../src/surface/canvas/edge-route';
import type { PerformanceCase } from './paired';

type RouteApi = Pick<typeof import('../../src/surface/canvas/edge-route'), 'routeEdge' | 'routeDraft'>;

export function routeCases(before: RouteApi, after: RouteApi): PerformanceCase[] {
    const source = { x: 0, y: 0, w: 100, h: 100 };
    const cases: PerformanceCase[] = [];

    for (const size of [0, 1, 10, 100]) {
        const obstacles: Obstacle[] = Array.from({ length: size }, (_, index) => ({
            id: `obstacle-${index}`,
            x: 200 + (index % 10) * 160,
            y: Math.floor(index / 10) * 200 - 400,
            w: 100,
            h: 100
        }));

        for (const shape of ['aligned', 'offset', 'held', 'draft'] as const) {
            const target = { x: 1900, y: shape === 'offset' ? 700 : 0, w: 100, h: 100 };
            const fixed: FixedSides = shape === 'held' ? { fromSide: 'top', toSide: 'bottom' } : {};
            const run = (api: RouteApi) =>
                shape === 'draft'
                    ? api.routeDraft(source, { x: target.x, y: target.y + 50 }, obstacles, fixed)
                    : api.routeEdge(source, target, obstacles, fixed);

            cases.push({ name: `route/${size}/${shape}`, before: () => run(before), after: () => run(after) });
        }
    }

    const wall: Obstacle[] = [
        { id: 'n', x: 500, y: -200, w: 400, h: 200 },
        { id: 'e', x: 800, y: -200, w: 100, h: 600 },
        { id: 's', x: 500, y: 300, w: 400, h: 100 },
        { id: 'w', x: 480, y: -200, w: 20, h: 600 }
    ];
    const target = { x: 600, y: 0, w: 100, h: 100 };
    cases.push({ name: 'route/walled', before: () => before.routeEdge(source, target, wall), after: () => after.routeEdge(source, target, wall) });

    return cases;
}
