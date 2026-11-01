import { resolve } from 'node:path';
import { measurePairs, type PerformanceCase } from './paired';
import { measureClientSweep } from './sweep-cases';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source apps/client/testing/performance/benchmark-sweep.ts <baseline checkout>');
}

const candidateRoot = resolve(import.meta.dir, '../../../..');

async function load(root: string) {
    const modules = await Promise.all([
        import(resolve(root, 'apps/client/src/canvas/edge-lines.ts')),
        import(resolve(root, 'apps/client/src/canvas/node-navigation.ts')),
        import(resolve(root, 'apps/client/src/canvas/editable-gaps.ts')),
        import(resolve(root, 'apps/client/src/base64.ts')),
        import(resolve(root, 'apps/server/src/git/status.ts')),
        import(resolve(root, 'apps/server/src/processes/tree.ts'))
    ]);

    return Object.assign({}, ...modules);
}

const before = await load(resolve(baselineRoot));
const after = await load(candidateRoot);
const serverCases: PerformanceCase[] = [];

for (const size of [100, 1000, 10_000]) {
    const porcelain =
        '# branch.head main\0# branch.ab +3 -2\0' +
        Array.from({ length: size }, (_, index) => `1 .M N... 100644 100644 100644 abc def src/folder ${index}/a file with many words.ts\0`).join('');
    const rates = new Map(
        Array.from({ length: size }, (_, index) => [
            `process-${index}`,
            { cpu: index % 4 ? index : null, memory: index % 3 ? index : null, diskRead: index % 5 ? index : null, diskWrite: index % 2 ? index : null }
        ])
    );
    const tree = { ruimte: new Set(rates.keys()) };
    serverCases.push(
        { name: `parsePorcelain/${size}`, before: () => before.parsePorcelain(porcelain), after: () => after.parsePorcelain(porcelain) },
        { name: `ruimteTotals/${size}`, before: () => before.ruimteTotals(tree, rates), after: () => after.ruimteTotals(tree, rates) },
        { name: `machineDisk/${size}`, before: () => before.machineDisk(rates), after: () => after.machineDisk(rates) }
    );
}

console.log(
    JSON.stringify({ runtime: Bun.version, baselineRoot, candidateRoot, client: measureClientSweep(before, after), server: measurePairs(serverCases) }, null, 2)
);
