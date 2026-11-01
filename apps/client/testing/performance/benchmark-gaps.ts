import { resolve } from 'node:path';
import { measureGapSweep } from './sweep-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source apps/client/testing/performance/benchmark-gaps.ts <baseline checkout>');
}

const candidateRoot = resolve(import.meta.dir, '../../../..');
const before = await import(resolve(baselineRoot, 'apps/client/src/canvas/editable-gaps.ts'));
const after = await import(resolve(candidateRoot, 'apps/client/src/canvas/editable-gaps.ts'));
console.log(JSON.stringify({ runtime: Bun.version, baselineRoot, candidateRoot, ...measureGapSweep(before, after) }, null, 2));
