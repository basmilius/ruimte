import type { ProcessRate, RawSample } from '../apps/server/src/processes/sampler.ts';
import { indexTree } from '../apps/server/src/processes/tree.ts';
import type { PerformanceCase } from '../apps/client/testing/performance/paired';

type GroupApi = Pick<typeof import('../apps/server/src/processes/tree.ts'), 'groupsFor'>;

export function processGroupCases(before: GroupApi, after: GroupApi): PerformanceCase[] {
    const cases: PerformanceCase[] = [];

    for (const size of [0, 10, 100, 1000, 10_000]) {
        const sessions = Array.from({ length: Math.min(10, Math.floor(size / 10)) }, (_, index) => ({
            id: `session-${index}`,
            pid: 101 + index,
            label: `Session ${index}`
        }));
        const sample: RawSample = {
            at: 0,
            awakeMs: 0,
            asleepMs: 0,
            machine: { cores: 8, cpuBusy: 0, cpuTotal: 0, memoryUsed: 0, memoryTotal: 0, diskFree: null, diskTotal: null },
            processes: Array.from({ length: size }, (_, index) => ({
                pid: 100 + index,
                ppid: index === 0 || index % 3 === 0 ? 1 : index <= sessions.length ? 100 : 101 + (index % Math.max(1, sessions.length)),
                uid: 501,
                startTime: (100 + index) * 1000,
                name: index % 17 === 0 ? 'codex' : 'process',
                path: null,
                readable: index % 11 !== 0,
                cpuNs: 0,
                memory: index,
                diskRead: 0,
                diskWrite: 0
            }))
        };
        const rates = new Map<string, ProcessRate>();

        for (const [index, process] of sample.processes.entries()) {
            if (index % 13 === 0) {
                continue;
            }

            rates.set(`${process.pid}:${process.startTime}`, {
                cpu: index % 4 === 0 ? null : ((index * 37) % 97) / 3,
                memory: index % 5 === 0 ? null : (index * 19) % 5000,
                diskRead: index % 3 === 0 ? null : index % 7,
                diskWrite: index % 2 === 0 ? null : index % 11,
                spawned: false
            });
        }

        const tree = indexTree(sample, { daemonPid: 100, sessions, chats: [] });

        for (const scope of ['ruimte', 'all'] as const) {
            for (const sort of ['cpu', 'memory', 'disk'] as const) {
                const limit = Math.min(100, Math.floor(size / 4));
                cases.push({
                    name: `groupsFor/${size}/${scope}/${sort}`,
                    before: () => before.groupsFor(tree, rates, scope, sort, limit),
                    after: () => after.groupsFor(tree, rates, scope, sort, limit)
                });
            }
        }
    }

    return cases;
}
