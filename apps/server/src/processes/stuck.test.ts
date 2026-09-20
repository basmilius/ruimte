import { describe, expect, test } from 'bun:test';
import { STUCK_THRESHOLDS, StuckJudge, type AgentState, type ObservedGroup, type ObservedProcess, type Observation } from './stuck.ts';

const MINUTE = 60_000;
const T0 = 1_800_000_000_000;

const proc = (pid: number, overrides: Partial<ObservedProcess> = {}): ObservedProcess => ({
    identity: `${pid}:1`,
    pid,
    startTime: 1,
    ppid: 100,
    name: `p${pid}`,
    ownFamily: null,
    readable: true,
    cpu: 0,
    memory: 100 * 1024 ** 2,
    disk: 0,
    ...overrides
});

const shell = (overrides: Partial<ObservedProcess> = {}) => proc(200, overrides);
const claude = (overrides: Partial<ObservedProcess> = {}) => proc(201, { ppid: 200, name: '2.1.269', ownFamily: 'claude', ...overrides });

const agent = (status: AgentState['status'], updatedAt: number, overrides: Partial<AgentState> = {}): AgentState => ({
    kind: 'claude',
    status,
    updatedAt,
    reportsEnd: true,
    ...overrides
});

const group = (processes: ObservedProcess[], state: AgentState | null, kind: ObservedGroup['kind'] = 'terminal'): ObservedGroup => ({
    nodeId: 'node-1',
    kind,
    agent: state,
    processes
});

const observation = (at: number, durationMs: number | null, groups: ObservedGroup[], overrides: Partial<Observation> = {}): Observation => {
    const everyone = [...groups.flatMap((entry) => entry.processes), ...(overrides.daemon ?? [])];
    return {
        at,
        durationMs,
        groups,
        daemonPid: 100,
        daemon: [],
        alive: new Map(everyone.map((process) => [process.identity, process.ppid])),
        strays: [],
        ...overrides
    };
};

/* Readings every `stepMs` from `from` to `to`, the first without a duration, as the monitor feeds them. */
const series = (judge: StuckJudge, from: number, to: number, stepMs: number, build: (at: number) => ObservedGroup[]) => {
    let last = judge.observe(observation(from, null, build(from)));
    for (let at = from + stepMs; at <= to; at += stepMs) {
        last = judge.observe(observation(at, stepMs, build(at)));
    }
    return last;
};

const kinds = (alerts: { kind: string }[]) => alerts.map((alert) => alert.kind);

describe('silent while working', () => {
    test('running for ten minutes without a hook, a tree at rest and no disk: a warning with the agent to interrupt', () => {
        const judge = new StuckJudge();
        const alerts = series(judge, T0, T0 + 12 * MINUTE, 2 * MINUTE, () => [group([shell(), claude({ cpu: 1 })], agent('running', T0))]);
        expect(kinds(alerts)).toEqual(['silent']);
        expect(alerts[0]!.pid).toBe(201);
        expect(alerts[0]!.since).toBe(T0);
    });

    test('five minute readings with a closed panel cover the window as well', () => {
        const judge = new StuckJudge();
        const alerts = series(judge, T0, T0 + 15 * MINUTE, 5 * MINUTE, () => [group([shell(), claude({ cpu: 2 })], agent('running', T0))]);
        expect(kinds(alerts)).toEqual(['silent']);
    });

    test('a tree that works, writes, starts processes or was not measured is not silent', () => {
        const busy = series(new StuckJudge(), T0, T0 + 12 * MINUTE, MINUTE, () => [group([shell(), claude({ cpu: 30 })], agent('running', T0))]);
        const writing = series(new StuckJudge(), T0, T0 + 12 * MINUTE, MINUTE, () => [
            group([shell(), claude({ cpu: 1, disk: 50_000 })], agent('running', T0))
        ]);
        const spawning = series(new StuckJudge(), T0, T0 + 12 * MINUTE, MINUTE, (at) => [
            group([shell(), claude({ cpu: 1 }), ...(at === T0 + 6 * MINUTE ? [proc(300, { ppid: 201 })] : [])], agent('running', T0))
        ]);
        const unreadable = series(new StuckJudge(), T0, T0 + 12 * MINUTE, MINUTE, () => [
            group([shell(), claude({ cpu: 1 }), proc(301, { readable: false, cpu: null, memory: null, disk: null })], agent('running', T0))
        ]);
        expect([busy, writing, spawning, unreadable].map(kinds)).toEqual([[], [], [], []]);
    });

    test('a series that does not reach back ten minutes proves nothing', () => {
        const judge = new StuckJudge();
        const alerts = series(judge, T0 + 8 * MINUTE, T0 + 12 * MINUTE, MINUTE, () => [group([shell(), claude({ cpu: 0 })], agent('running', T0))]);
        expect(alerts).toEqual([]);
    });

    test('the idle baseline of the node itself sets how quiet silent is', () => {
        const judge = new StuckJudge();
        // Idle at 8% for twenty minutes, above the default floor, so 9% while running still reads as silent.
        series(judge, T0, T0 + 20 * MINUTE, MINUTE, () => [group([shell(), claude({ cpu: 8 })], agent('idle', T0 - MINUTE))]);
        const start = T0 + 20 * MINUTE;
        let alerts = judge.observe(observation(start + MINUTE, MINUTE, [group([shell(), claude({ cpu: 9 })], agent('running', start))]));
        for (let at = start + 2 * MINUTE; at <= start + 12 * MINUTE; at += MINUTE) {
            alerts = judge.observe(observation(at, MINUTE, [group([shell(), claude({ cpu: 9 })], agent('running', start))]));
        }
        expect(kinds(alerts)).toEqual(['silent']);
    });
});

describe('busy after the turn', () => {
    test('idle by the hooks and one process above 80% of a core for a minute', () => {
        const judge = new StuckJudge();
        const watcher = proc(210, { ppid: 200, name: 'vitest' });
        const alerts = series(judge, T0, T0 + 90_000, 30_000, (at) => [group([shell(), claude(), { ...watcher, cpu: at === T0 ? 0 : 95 }], agent('idle', T0))]);
        expect(kinds(alerts)).toEqual(['busy-after-turn']);
        expect(alerts[0]!.pid).toBe(210);
    });

    test('work that started during the turn does not count against the moment it ended', () => {
        const judge = new StuckJudge();
        const alerts = series(judge, T0, T0 + 60_000, 30_000, () => [group([shell(), proc(210, { cpu: 95 })], agent('idle', T0 + 45_000))]);
        expect(alerts).toEqual([]);
    });

    test('one five minute reading averaged above the line is enough with a closed panel', () => {
        const judge = new StuckJudge();
        judge.observe(observation(T0, null, [group([shell(), proc(210, { cpu: 0 })], agent('idle', T0))]));
        const alerts = judge.observe(observation(T0 + 5 * MINUTE, 5 * MINUTE, [group([shell(), proc(210, { cpu: 85 })], agent('idle', T0))]));
        expect(kinds(alerts)).toEqual(['busy-after-turn']);
    });
});

describe('memory', () => {
    test('a footprint of 2 GB, or 512 MB more within a minute', () => {
        const big = new StuckJudge().observe(observation(T0, null, [group([shell({ memory: 2.1 * 1024 ** 3 })], null)]));
        expect(kinds(big)).toEqual(['memory']);

        const judge = new StuckJudge();
        judge.observe(observation(T0, null, [group([shell({ memory: 300 * 1024 ** 2 })], null)]));
        judge.observe(observation(T0 + 20_000, 20_000, [group([shell({ memory: 400 * 1024 ** 2 })], null)]));
        const grown = judge.observe(observation(T0 + 40_000, 20_000, [group([shell({ memory: 950 * 1024 ** 2 })], null)]));
        expect(kinds(grown)).toEqual(['memory']);
        expect(grown[0]!.since).toBe(T0 + 20_000);
    });
});

describe('agent gone', () => {
    test('running by the hooks but no agent left in the shell, for a CLI that says SessionEnd', () => {
        const alerts = new StuckJudge().observe(observation(T0 + MINUTE, null, [group([shell()], agent('running', T0))]));
        expect(kinds(alerts)).toEqual(['agent-gone']);
    });

    test('never for a CLI without SessionEnd, while the agent is there, right after a hook, or with an unreadable tree', () => {
        const judge = () => new StuckJudge();
        expect(judge().observe(observation(T0 + MINUTE, null, [group([shell()], agent('running', T0, { reportsEnd: false }))]))).toEqual([]);
        expect(judge().observe(observation(T0 + MINUTE, null, [group([shell(), claude()], agent('running', T0))]))).toEqual([]);
        expect(judge().observe(observation(T0 + 1000, null, [group([shell()], agent('running', T0))]))).toEqual([]);
        expect(judge().observe(observation(T0 + MINUTE, null, [group([shell({ readable: false })], agent('running', T0))]))).toEqual([]);
        expect(judge().observe(observation(T0 + MINUTE, null, [group([shell()], agent('running', T0), 'chat')]))).toEqual([]);
    });
});

describe('orphans', () => {
    test('what was inside a node that ended and now lives under launchd', () => {
        const judge = new StuckJudge();
        const sleeper = proc(220, { ppid: 200, name: 'sleep' });
        judge.observe(observation(T0, null, [group([shell(), sleeper], null)]));
        const orphaned = judge.observe(observation(T0 + 2000, 2000, [], { alive: new Map([[sleeper.identity, 1]]) }));
        expect(kinds(orphaned)).toEqual(['orphan']);
        expect(orphaned[0]).toMatchObject({ nodeId: 'node-1', pid: 220, name: 'sleep' });
        expect(judge.observe(observation(T0 + 4000, 2000, [], { alive: new Map() }))).toEqual([]);
    });

    test('a stray whose environment names a session this daemon no longer runs', () => {
        const stray = proc(230, { ppid: 1, name: 'vite' });
        const alerts = new StuckJudge().observe(
            observation(T0, null, [], { strays: [{ process: stray, nodeId: 'old-node' }], alive: new Map([[stray.identity, 1]]) })
        );
        expect(alerts).toMatchObject([{ kind: 'orphan', nodeId: 'old-node', pid: 230 }]);
    });
});

describe('a probe that hangs', () => {
    test('git or an agent CLI the daemon started, past twice its timeout', () => {
        const git = proc(400, { name: 'git', startTime: (T0 - 5 * MINUTE) * 1000 });
        const probe = proc(401, { name: '2.1.269', ownFamily: 'claude', startTime: (T0 - MINUTE) * 1000 });
        const alerts = new StuckJudge().observe(observation(T0, null, [], { daemon: [proc(100, { ppid: 50 }), git, probe] }));
        expect(alerts).toMatchObject([{ kind: 'probe-hung', pid: 400 }]);
        expect(STUCK_THRESHOLDS.hungGitMs).toBeLessThan(5 * MINUTE);
    });
});

describe('dismissing', () => {
    test('keeps a warning quiet until the hook status moves on', () => {
        const judge = new StuckJudge();
        const first = judge.observe(observation(T0 + MINUTE, null, [group([shell()], agent('running', T0))]));
        judge.dismiss(first[0]!.id);
        expect(judge.observe(observation(T0 + 2 * MINUTE, MINUTE, [group([shell()], agent('running', T0))]))).toEqual([]);
        expect(kinds(judge.observe(observation(T0 + 3 * MINUTE, MINUTE, [group([shell()], agent('running', T0 + 2 * MINUTE))])))).toEqual(['agent-gone']);
    });
});
