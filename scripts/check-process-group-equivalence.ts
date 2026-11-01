import { deepStrictEqual } from 'node:assert';
import { resolve } from 'node:path';
import type { ProcessRate, RawSample } from '../apps/server/src/processes/sampler.ts';
import * as after from '../apps/server/src/processes/tree.ts';

const baselineRoot = process.argv[2];

if (!baselineRoot) {
    throw new Error('Usage: bun --conditions=source scripts/check-process-group-equivalence.ts <baseline checkout>');
}

const before: typeof after = await import(resolve(baselineRoot, 'apps/server/src/processes/tree.ts'));
let seed = 20261102;

function random(limit: number): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % limit;
}

for (let sample = 0; sample < 1000; sample++) {
    const size = random(150);
    const table: RawSample = {
        at: 0,
        awakeMs: 0,
        asleepMs: 0,
        machine: { cores: 8, cpuBusy: 0, cpuTotal: 0, memoryUsed: 0, memoryTotal: 0, diskFree: null, diskTotal: null },
        processes: Array.from({ length: size }, (_, index) => ({
            pid: 100 + index,
            ppid: index === 0 || random(4) === 0 ? 0 : 100 + random(index),
            uid: 501,
            startTime: index * 1000,
            name: ['node', 'codex', 'claude', 'mds', 'Electron'][random(5)]!,
            path: null,
            readable: random(4) !== 0,
            cpuNs: 0,
            memory: 0,
            diskRead: 0,
            diskWrite: 0
        }))
    };
    const roots = {
        daemonPid: 100,
        sessions: Array.from({ length: random(8) }, (_, index) => ({
            id: `session-${index}`,
            pid: 100 + random(size + 1),
            ...(index % 2 === 0 ? { label: `Launch ${index}` } : {})
        })),
        chats: Array.from({ length: random(4) }, (_, index) => ({ id: `chat-${index}`, pid: 100 + random(size + 1) }))
    };
    const tree = after.indexTree(table, roots);
    const rates = new Map<string, ProcessRate>();
    const value = (): number | null => (random(3) === 0 ? null : random(5) / 3);

    for (const process of table.processes) {
        if (random(4) !== 0) {
            rates.set(`${process.pid}:${process.startTime}`, { cpu: value(), memory: value(), diskRead: value(), diskWrite: value(), spawned: false });
        }
    }

    const savedTree = structuredClone(tree);
    const savedRates = structuredClone(rates);
    const limit = random(40) - 1;

    for (const scope of ['ruimte', 'all'] as const) {
        for (const sort of ['cpu', 'memory', 'disk'] as const) {
            deepStrictEqual(
                after.groupsFor(tree, rates, scope, sort, limit),
                before.groupsFor(tree, rates, scope, sort, limit),
                `groupsFor ${sample}/${scope}/${sort}`
            );
        }
    }

    deepStrictEqual(tree, savedTree, `index unchanged ${sample}`);
    deepStrictEqual(rates, savedRates, `rates unchanged ${sample}`);
}

console.log(JSON.stringify({ seed: 20261102, samples: 1000, comparisons: 8000, result: 'identical' }));
