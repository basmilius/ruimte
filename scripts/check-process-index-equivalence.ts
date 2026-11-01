import { deepStrictEqual } from 'node:assert';
import { resolve } from 'node:path';
import type { RawSample } from '../apps/server/src/processes/sampler.ts';
import * as after from '../apps/server/src/processes/tree.ts';

const baselineModule = process.argv[2];

if (!baselineModule) {
    throw new Error('Usage: bun --conditions=source scripts/check-process-index-equivalence.ts <before module>');
}

const before: typeof after = await import(resolve(baselineModule));
const words = [
    'claude',
    'codex',
    'antigravity',
    'agy',
    'copilot',
    'grok',
    'opencode',
    'ollama',
    'cursor',
    'aider',
    'precursor',
    'codexify',
    'ClAuDe',
    'KODEx',
    'normal'
];
const separators = ['/', ' ', '\n', '\r\n', '@', '_', '-', '.', '', 'x', 'é', '\u00a0', '\uFEFF', '\\'];
let seed = 20261103;

function random(limit: number): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return (seed >>> 8) % limit;
}

function word(): string {
    return `${words[random(words.length)]}${separators[random(separators.length)]}${words[random(words.length)]}`;
}

for (let sample = 0; sample < 5000; sample++) {
    const name = word();
    const path = random(3) === 0 ? null : word();
    const args = random(3) === 0 ? null : Array.from({ length: random(6) }, word);

    if (args !== null && sample % 7 === 0) {
        args.length = 2;
        delete args[0];
        args[1] = word();
    }

    const saved = structuredClone(args);
    deepStrictEqual(after.ownFamilyOf(name, path, args), before.ownFamilyOf(name, path, args), `ownFamilyOf ${sample}`);
    deepStrictEqual(args, saved, `arguments unchanged ${sample}`);
}

for (let sample = 0; sample < 1000; sample++) {
    const size = random(120);
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
            name: word(),
            path: random(3) === 0 ? null : word(),
            readable: random(4) !== 0,
            cpuNs: 0,
            memory: 0,
            diskRead: 0,
            diskWrite: 0
        }))
    };
    const roots = {
        daemonPid: 100,
        sessions: Array.from({ length: random(8) }, (_, index) => ({ id: `session-${index}`, pid: 100 + random(size + 1) })),
        chats: Array.from({ length: random(4) }, (_, index) => ({ id: `chat-${index}`, pid: 100 + random(size + 1) }))
    };
    const savedTable = structuredClone(table);
    const savedRoots = structuredClone(roots);
    const beforeCalls: number[] = [];
    const afterCalls: number[] = [];
    const original = before.indexTree(table, roots, (process) => {
        beforeCalls.push(process.pid);
        return [process.name, sample % 2 === 0 ? '/tools/claude' : '/tools/worker'];
    });
    const changed = after.indexTree(table, roots, (process) => {
        afterCalls.push(process.pid);
        return [process.name, sample % 2 === 0 ? '/tools/claude' : '/tools/worker'];
    });
    deepStrictEqual(changed, original, `indexTree ${sample}`);
    deepStrictEqual([...changed.family], [...original.family], `inherited family order ${sample}`);
    deepStrictEqual([...changed.ownFamily], [...original.ownFamily], `own family order ${sample}`);
    deepStrictEqual(
        changed.groups.map((group) => group.entries.map((entry) => table.processes.indexOf(entry.process))),
        original.groups.map((group) => group.entries.map((entry) => table.processes.indexOf(entry.process))),
        `process references ${sample}`
    );
    deepStrictEqual(afterCalls, beforeCalls, `argument callback order ${sample}`);
    deepStrictEqual(table, savedTable, `sample unchanged ${sample}`);
    deepStrictEqual(roots, savedRoots, `roots unchanged ${sample}`);
}

console.log(JSON.stringify({ seed: 20261103, familySamples: 5000, indexSamples: 1000, comparisons: 17000, result: 'identical' }));
