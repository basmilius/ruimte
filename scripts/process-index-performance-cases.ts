import type { RawSample } from '../apps/server/src/processes/sampler.ts';
import type { PerformanceCase } from '../apps/client/testing/performance/paired';

type ProcessApi = Pick<typeof import('../apps/server/src/processes/tree.ts'), 'ownFamilyOf' | 'indexTree' | 'groupsFor'>;

export function processIndexCases(before: ProcessApi, after: ProcessApi): PerformanceCase[] {
    const cases: PerformanceCase[] = [];
    const families: [string, string | null, string[] | null][] = [
        ['zsh', '/bin/zsh', null],
        [
            'mdworker_shared',
            '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/Metadata.framework/Versions/A/Support/mdworker_shared',
            null
        ],
        ['claude', null, null],
        ['codex', '/opt/homebrew/bin/codex', null],
        ['node', '/opt/homebrew/bin/node', ['node', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js']],
        ['node', '/usr/bin/node', ['node', '/opt/tools/worker.js']],
        ['cursor', '/Applications/Cursor.app/Contents/MacOS/Cursor', []],
        ['agy', '/usr/local/bin/agy', ['agy']],
        ['aider', null, ['aider', '--model']],
        ['claude-codex', '/tools/grok', ['node', '/tools/cursor']],
        ['precursor', '/tools/codexify', ['node', '/a/claudette']],
        ['CLAUDE', '/tools/CODEX', ['AGY']],
        ['worker', null, []]
    ];

    for (const [index, args] of families.entries()) {
        cases.push({ name: `ownFamilyOf/${index}/${args[0]}`, before: () => before.ownFamilyOf(...args), after: () => after.ownFamilyOf(...args) });
    }

    for (const size of [0, 10, 100, 1000, 10_000]) {
        for (const frequency of [0, 20, 2]) {
            for (const pathMode of ['none', 'mixed']) {
                const sample: RawSample = {
                    at: 0,
                    awakeMs: 0,
                    asleepMs: 0,
                    machine: { cores: 8, cpuBusy: 0, cpuTotal: 0, memoryUsed: 0, memoryTotal: 0, diskFree: null, diskTotal: null },
                    processes: Array.from({ length: size }, (_, index) => ({
                        pid: 100 + index,
                        ppid: index === 0 || index % 3 === 0 ? 1 : index <= 10 ? 100 : 101 + (index % 10),
                        uid: 501,
                        startTime: (100 + index) * 1000,
                        name: frequency !== 0 && index % frequency === 0 ? 'claude' : 'process',
                        path:
                            pathMode === 'mixed' && index % 5 !== 0
                                ? `/usr/local/bin/${frequency !== 0 && index % frequency === 0 ? 'claude' : 'worker'}`
                                : null,
                        readable: true,
                        cpuNs: 0,
                        memory: index,
                        diskRead: 0,
                        diskWrite: 0
                    }))
                };
                const roots = {
                    daemonPid: 100,
                    sessions: Array.from({ length: Math.min(10, Math.max(0, size - 1)) }, (_, index) => ({ id: `session-${index}`, pid: 101 + index })),
                    chats: []
                };
                const argsOf = () => ['node', '/usr/local/lib/worker.js'];
                cases.push({
                    name: `indexTree/${size}/family-every-${frequency}/${pathMode}`,
                    before: () => before.indexTree(sample, roots, argsOf),
                    after: () => after.indexTree(sample, roots, argsOf)
                });

                if (pathMode === 'mixed' && frequency === 20 && size >= 1000) {
                    const rates = new Map(
                        sample.processes.map((process, index) => [
                            `${process.pid}:${process.startTime}`,
                            { cpu: index % 7, memory: index, diskRead: 0, diskWrite: 0, spawned: false }
                        ])
                    );
                    cases.push({
                        name: `indexTree+groupsFor/${size}/mixed`,
                        before: () => before.groupsFor(before.indexTree(sample, roots, argsOf), rates, 'all', 'cpu', 100),
                        after: () => after.groupsFor(after.indexTree(sample, roots, argsOf), rates, 'all', 'cpu', 100)
                    });
                }
            }
        }
    }

    return cases;
}
