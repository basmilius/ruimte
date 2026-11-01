import type { StackedNode } from '../../src/canvas/stacking';
import { measurePairs, type PerformanceCase } from './paired';

interface StackingApi {
    stackingOrder: typeof import('../../src/canvas/stacking').stackingOrder;
    nodesOverBrowsers: typeof import('../../src/canvas/stacking').nodesOverBrowsers;
}

export function measureStacking(before: StackingApi, after: StackingApi) {
    const cases: PerformanceCase[] = [];

    for (const size of [10, 100, 255, 256, 1000]) {
        const order = Array.from({ length: size }, (_, index) => `node-${index}`);
        const nodes: Record<string, StackedNode> = Object.fromEntries(
            order.map((id, index) => [id, { kind: index % 10 === 0 ? 'group' : 'note', x: (index % 20) * 120, y: Math.floor(index / 20) * 100, w: 100, h: 80 }])
        );

        cases.push({ name: `stackingOrder/${size}`, before: () => before.stackingOrder(nodes, order), after: () => after.stackingOrder(nodes, order) });

        for (const pages of [0, 1, Math.max(2, Math.floor(size / 10))]) {
            const mixed = { ...nodes };

            for (let index = 0; index < pages; index++) {
                mixed[order[index]!] = { kind: 'browser', x: (index % 5) * 60, y: Math.floor(index / 5) * 60, w: 800, h: 600 };
            }

            const hidden = new Set(order.filter((_, index) => index % 13 === 12));
            const ringed = new Set(order.filter((_, index) => index % 3 === 1));
            cases.push({
                name: `nodesOverBrowsers/${size}/pages-${pages}`,
                before: () => before.nodesOverBrowsers(mixed, order, hidden, ringed),
                after: () => after.nodesOverBrowsers(mixed, order, hidden, ringed)
            });
        }
    }

    return measurePairs(cases);
}
