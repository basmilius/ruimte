import { deepStrictEqual } from 'node:assert';
import { resolve } from 'node:path';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source scripts/check-route-equivalence.ts <baseline checkout>');
}

const after = await import(resolve(import.meta.dir, '../apps/client/src/surface/canvas/edge-route.ts'));
const before = await import(resolve(baselineRoot, 'apps/client/src/canvas/edge-route.ts'));
const sides = ['top', 'right', 'bottom', 'left'] as const;
let seed = 20261101;

function random(limit: number): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % limit;
}

for (let sample = 0; sample < 2000; sample++) {
    const unit = sample % 3 === 0 ? 0.25 : 1;
    const source = { x: (random(1000) - 500) * unit, y: (random(1000) - 500) * unit, w: random(500) * unit, h: random(500) * unit };
    const target = { x: (random(2000) - 1000) * unit, y: (random(2000) - 1000) * unit, w: random(500) * unit, h: random(500) * unit };
    const obstacles = Array.from({ length: random(sample % 10 === 0 ? 100 : 10) }, (_, index) => ({
        id: `node-${index}`,
        x: (random(2000) - 1000) * unit,
        y: (random(2000) - 1000) * unit,
        w: random(400) * unit,
        h: random(400) * unit
    }));
    const fixed: { fromSide?: (typeof sides)[number]; toSide?: (typeof sides)[number]; fromDown?: number; toDown?: number } = {};

    if (sample % 2 === 0) {
        fixed.fromSide = sides[random(sides.length)];
    }

    if (sample % 3 === 0) {
        fixed.toSide = sides[random(sides.length)];
    }

    if (sample % 5 === 0) {
        fixed.fromDown = random(500) * unit;
        fixed.toDown = random(500) * unit;
    }

    deepStrictEqual(after.routeEdge(source, target, obstacles, fixed), before.routeEdge(source, target, obstacles, fixed), `routeEdge ${sample}`);
    const point = { x: target.x, y: target.y };
    deepStrictEqual(after.routeDraft(source, point, obstacles, fixed), before.routeDraft(source, point, obstacles, fixed), `routeDraft ${sample}`);
}

console.log(JSON.stringify({ seed: 20261101, samples: 2000, comparisons: 4000, result: 'identical' }));
