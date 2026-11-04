import { resolve } from 'node:path';
import { measurePairs } from '../apps/client/testing/performance/paired';
import * as after from '../apps/server/src/processes/tree.ts';
import { processGroupCases } from './process-group-performance-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source scripts/benchmark-process-groups.ts <baseline checkout>');
}

const before: typeof after = await import(resolve(baselineRoot, 'apps/server/src/processes/tree.ts'));
console.log(JSON.stringify(measurePairs(processGroupCases(before, after)), null, 2));
