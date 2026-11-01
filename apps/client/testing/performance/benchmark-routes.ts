import { resolve } from 'node:path';
import * as after from '../../src/canvas/edge-route';
import { measurePairs } from './paired';
import { routeCases } from './route-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source apps/client/testing/performance/benchmark-routes.ts <baseline checkout>');
}

const before: typeof after = await import(resolve(baselineRoot, 'apps/client/src/canvas/edge-route.ts'));
console.log(JSON.stringify(measurePairs(routeCases(before, after)), null, 2));
