import { resolve } from 'node:path';
import { measurePairs, type PerformanceCase } from '../apps/client/testing/performance/paired';
import type { DrawingElement } from '../packages/contracts/src/drawing-host';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source scripts/benchmark-drawing-context.ts <baseline checkout>');
}

const candidateRoot = resolve(import.meta.dir, '..');
const before = await import(resolve(baselineRoot, 'apps/server/src/context/context-drawing.ts'));
const after = await import(resolve(candidateRoot, 'apps/server/src/context/context-drawing.ts'));
const { drawingCases } = await import(resolve(candidateRoot, '../adecore/scripts/drawing-performance-cases.ts'));
const cases: PerformanceCase[] = [];
const fixtures = new Set(['readingOrder/10/arrows-1/chain', 'readingOrder/100/arrows-0/chain', 'readingOrder/100/arrows-50/chain']);

for (const tail of [null, 20]) {
    const entries: PerformanceCase[] = drawingCases(
        { readingOrder: (elements: readonly DrawingElement[]) => [before.renderDrawing(elements, tail)] },
        { readingOrder: (elements: readonly DrawingElement[]) => [after.renderDrawing(elements, tail)] }
    );

    for (const entry of entries) {
        if (fixtures.has(entry.name)) {
            cases.push({ ...entry, name: entry.name.replace('readingOrder/', `renderDrawing/${tail === null ? 'full-svg' : 'tail-20'}/`) });
        }
    }
}

console.log(JSON.stringify(measurePairs(cases), null, 2));
