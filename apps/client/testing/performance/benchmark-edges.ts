import { resolve } from 'node:path';
import { measureEdgeSweep } from './sweep-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source apps/client/testing/performance/benchmark-edges.ts <baseline checkout>');
}

const candidateRoot = resolve(import.meta.dir, '../../../..');
const before = await import(resolve(baselineRoot, 'apps/client/src/canvas/edge-lines.ts'));
const after = await import(resolve(candidateRoot, 'apps/client/src/canvas/edge-lines.ts'));
console.log(JSON.stringify({ runtime: Bun.version, baselineRoot, candidateRoot, ...measureEdgeSweep(before, after) }, null, 2));
