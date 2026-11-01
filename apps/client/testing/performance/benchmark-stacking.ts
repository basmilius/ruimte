import { resolve } from 'node:path';
import { measureStacking } from './stacking-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source apps/client/testing/performance/benchmark-stacking.ts <baseline checkout>');
}

const candidateRoot = resolve(import.meta.dir, '../../../..');
const before = await import(resolve(baselineRoot, 'apps/client/src/canvas/stacking.ts'));
const after = await import(resolve(candidateRoot, 'apps/client/src/canvas/stacking.ts'));
console.log(JSON.stringify({ runtime: Bun.version, baselineRoot, candidateRoot, ...measureStacking(before, after) }, null, 2));
