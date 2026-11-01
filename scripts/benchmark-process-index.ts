import { deepStrictEqual } from 'node:assert';
import { resolve } from 'node:path';
import * as after from '../apps/server/src/processes/tree.ts';
import { measurePairs } from '../apps/client/testing/performance/paired';
import { processIndexCases } from './process-index-performance-cases';

const baselineModule = process.argv[2];

if (!baselineModule) {
    throw new Error('Usage: bun --conditions=source scripts/benchmark-process-index.ts <before module>');
}

const before: typeof after = await import(resolve(baselineModule));
const cases = processIndexCases(before, after);

for (const entry of cases) {
    deepStrictEqual(entry.after(), entry.before(), entry.name);
}

console.log(JSON.stringify(measurePairs(cases), null, 2));
