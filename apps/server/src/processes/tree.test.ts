import { describe, expect, test } from 'bun:test';
import { groupsFor, indexTree, ownFamilyOf, ruimteTotals } from './tree.ts';
import { identityOf, type ProcessRate, type RawProcess, type RawSample } from './sampler.ts';

const proc = (pid: number, ppid: number, name: string, path: string | null = null, overrides: Partial<RawProcess> = {}): RawProcess => ({
    pid,
    ppid,
    uid: 501,
    startTime: pid * 1000,
    name,
    path,
    readable: true,
    cpuNs: 0,
    memory: pid,
    diskRead: 0,
    diskWrite: 0,
    ...overrides
});

const TABLE: RawProcess[] = [
    proc(1, 0, 'launchd', '/sbin/launchd'),
    proc(40, 1, 'claude', '/Users/x/.local/share/claude/versions/2.1.269'),
    proc(50, 40, 'Ruimte', '/Applications/Ruimte.app/Contents/MacOS/Ruimte'),
    proc(
        51,
        50,
        'Ruimte Helper (Renderer)',
        '/Applications/Ruimte.app/Contents/Frameworks/Ruimte Helper (Renderer).app/Contents/MacOS/Ruimte Helper (Renderer)'
    ),
    proc(100, 50, 'ruimte', '/Applications/Ruimte.app/Contents/Resources/ruimte'),
    proc(200, 100, 'zsh', '/bin/zsh'),
    proc(201, 200, '2.1.269', '/Users/x/.local/share/claude/versions/2.1.269'),
    proc(202, 201, 'node', '/opt/homebrew/bin/node'),
    proc(300, 100, 'node', '/opt/homebrew/bin/node'),
    proc(400, 100, 'git', '/usr/bin/git'),
    proc(10, 1, 'iTerm2', '/Applications/iTerm.app/Contents/MacOS/iTerm2'),
    proc(11, 10, 'codex', '/opt/homebrew/bin/codex'),
    proc(12, 1, 'mds', '/usr/libexec/mds', { readable: false, cpuNs: null, memory: null, diskRead: null, diskWrite: null })
];

const SAMPLE: RawSample = {
    at: 0,
    awakeMs: 0,
    asleepMs: 0,
    processes: TABLE,
    machine: { cores: 8, cpuBusy: 0, cpuTotal: 0, memoryUsed: 0, memoryTotal: 0, diskFree: null, diskTotal: null }
};

const ROOTS = { daemonPid: 100, sessions: [{ id: 'term-1', pid: 200 }], chats: [{ id: 'chat-1', pid: 300 }] };

const rates = (cpu: Record<number, number>): Map<string, ProcessRate> =>
    new Map(
        TABLE.map((process) => [
            identityOf(process.pid, process.startTime),
            {
                cpu: process.readable ? (cpu[process.pid] ?? 0) : null,
                memory: process.memory,
                diskRead: process.readable ? 0 : null,
                diskWrite: process.readable ? 0 : null,
                spawned: false
            }
        ])
    );

describe('the families', () => {
    test('a native CLI names itself in its path, one on a runtime in its script', () => {
        expect(ownFamilyOf('2.1.269', '/Users/x/.local/share/claude/versions/2.1.269')).toBe('claude');
        expect(ownFamilyOf('node', '/opt/homebrew/bin/node', ['node', '/usr/local/lib/node_modules/@openai/codex/bin/codex.js'])).toBe('codex');
        expect(ownFamilyOf('zsh', '/bin/zsh')).toBeNull();
        // A word inside another word is not a family.
        expect(ownFamilyOf('precursor', '/usr/bin/precursor')).toBeNull();
    });
});

describe('the tree of Ruimte', () => {
    const index = indexTree(SAMPLE, ROOTS, (process) => (process.pid === 300 ? ['node', '/x/@anthropic-ai/claude-code/cli.js'] : null));

    test('groups a node per session and chat, the app around the daemon, and the daemon with its own tasks', () => {
        const groups = Object.fromEntries(index.groups.map((group) => [group.id, group.entries.map((entry) => [entry.process.pid, entry.depth])]));
        expect(groups).toEqual({
            'terminal:term-1': [
                [200, 0],
                [201, 1],
                [202, 2]
            ],
            'chat:chat-1': [[300, 0]],
            app: [
                [50, 0],
                [51, 1]
            ],
            daemon: [
                [100, 0],
                [400, 1]
            ]
        });
    });

    test('a family is inherited down a group but never through the daemon from what started it', () => {
        const family = (pid: number) => index.family.get(identityOf(pid, pid * 1000));
        expect(family(202)).toBe('claude');
        expect(family(300)).toBe('claude');
        expect(family(200)).toBeNull();
        expect(family(400)).toBeNull();
        expect(index.ownFamily.get(identityOf(202, 202_000))).toBeNull();
    });

    test('"All" adds the rest of the machine: the top readable ones plus every AI process', () => {
        const groups = groupsFor(index, rates({ 12: 99, 10: 3 }), 'all', 'cpu', 1);
        const other = groups.find((group) => group.kind === 'other')!;
        // 40 is the Claude that started the app: outside Ruimte's tree, so it is listed with the rest.
        expect(other.processes.map((row) => row.pid)).toEqual([10, 40, 11]);
        expect(other.hidden).toBe(2);
    });

    test('nodes sort on the chosen number, the app and the daemon stay below them', () => {
        const groups = groupsFor(index, rates({ 300: 50, 201: 10 }), 'ruimte', 'cpu', 50);
        expect(groups.map((group) => group.id)).toEqual(['chat:chat-1', 'terminal:term-1', 'app', 'daemon']);
        expect(groups[1]!.cpu).toBe(10);
    });

    test('the share of Ruimte sums its readable processes', () => {
        expect(ruimteTotals(index, rates({ 201: 10, 300: 5, 51: 20 })).cpu).toBe(35);
    });
});
