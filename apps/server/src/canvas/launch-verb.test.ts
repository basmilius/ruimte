import { beforeEach, describe, expect, test } from 'bun:test';
import type { LaunchStartResult, LaunchStatus } from '@ruimte/contracts';
import { refusalBody } from '@ruimte/agents/context/refusal';
import { agentLaunches } from '../launches/agent-host.ts';
import type { LaunchStartOptions } from '../launches/runner.ts';
import type { ResolvedLaunch } from '../launches/store.ts';
import { VerbRefusal, type CanvasHost, type LaunchHost, type LaunchReading, type Noun } from './verb.ts';
import { VERBS, verbNamed } from './verbs.ts';

const noun = verbNamed('launches') as Noun;

const status = (launchId: string, overrides: Partial<LaunchStatus> = {}): LaunchStatus => ({
    projectId: 'p1',
    launchId,
    sessionId: `launch:p1:${launchId}`,
    kind: 'service',
    state: 'running',
    exitCode: null,
    startedAt: 0,
    endedAt: null,
    port: 5173,
    url: 'http://localhost:5173',
    stopped: false,
    ...overrides
});

const reading = (launchId: string, overrides: Partial<LaunchReading> = {}): LaunchReading => ({
    launchId,
    name: launchId,
    kind: 'service',
    approved: true,
    url: null,
    port: null,
    members: [],
    status: null,
    ...overrides
});

let launches: LaunchReading[];
let startResult: LaunchStartResult;
let calls: string[];
let host: CanvasHost;

const launchHost = (): LaunchHost => ({
    list: async () => launches,
    text: async (_projectId, launchId) => (launchId === 'dev' ? 'one\ntwo\nthree' : null),
    start: async (_projectId, launchId, restart) => {
        calls.push(`${restart ? 'restart' : 'start'} ${launchId}`);
        return startResult;
    },
    stop: async (_projectId, launchId) => {
        calls.push(`stop ${launchId}`);
        return launchId === 'dev' ? 1 : 0;
    }
});

beforeEach(() => {
    launches = [
        reading('dev', { name: 'Dev', url: 'http://localhost:5173', port: 5173, status: status('dev') }),
        reading('tests', { name: 'Tests', kind: 'task', approved: false, status: status('tests', { kind: 'task', state: 'exited', exitCode: 1, port: null }) }),
        reading('stack', { name: 'Full stack', kind: 'group', approved: false, members: ['dev', 'tests'] })
    ];
    startResult = { outcome: 'started' };
    calls = [];
    host = {
        locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: '/tmp/p1', canvasId: 'main' } : null),
        launches: launchHost()
    } as unknown as CanvasHost;
});

const run = async (argv: string[]): Promise<string[]> => {
    try {
        return await noun.run(argv, { caller: 'chat-1', host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
};

describe('ruimte-context launches', () => {
    test('is a noun of help with every action', () => {
        expect(VERBS).toContain(noun);
        expect(noun.actions.map((action) => action.word)).toEqual(['list', 'read', 'start', 'restart', 'stop']);
    });

    test('lists every launch with its state and whether a person approved it', async () => {
        expect(await run(['list'])).toEqual([
            'dev\tDev\tservice\trunning\tyes\t5173\thttp://localhost:5173\t-',
            'tests\tTests\ttask\texited:1\tno\t-\t-\t-',
            'stack\tFull stack\tgroup\t-\tno\t-\t-\tdev,tests'
        ]);
        launches = [];
        expect(await run(['list'])).toEqual(['note\tThis project has no launches; a person adds them from the launch chip in the toolbar']);
    });

    test('reads the output by id or by name, and says when it never ran', async () => {
        expect(await run(['read', 'Dev', '--tail', '2'])).toEqual(['two', 'three']);
        expect(await run(['read', 'tests'])).toEqual(['note\tTests has not run since this machine started']);
        expect((await run(['read', 'stack']))[0]).toStartWith('refused\tlaunch-group\t');
    });

    test('names what it has when a launch is unknown or its name is not unique', async () => {
        expect(await run(['read', 'web'])).toEqual([
            'refused\tunknown-launch\tThis project has no launch web',
            'launch\tdev\tDev',
            'launch\ttests\tTests',
            'launch\tstack\tFull stack'
        ]);
        launches = [...launches, reading('dev-2', { name: 'Dev' })];
        expect((await run(['start', 'dev']))[0]).toBe('started\tdev\tDev');
        expect(await run(['start', 'Dev'])).toEqual([
            'refused\tambiguous-launch\t2 launches are called Dev; name one by its id',
            'launch\tdev\tDev',
            'launch\tdev-2\tDev'
        ]);
    });

    test('starts and restarts an approved launch', async () => {
        expect(await run(['start', 'dev'])).toEqual([
            'started\tdev\tDev',
            'see\truimte-context launches list\twhether it came up; ruimte-context launches read dev for its output'
        ]);
        expect((await run(['restart', 'Full stack']))[0]).toBe('restarted\tstack\tFull stack\tdev,tests');
        expect(calls).toEqual(['start dev', 'restart stack']);
    });

    test('refuses a launch nobody approved here, and one whose port is taken', async () => {
        startResult = { outcome: 'held', held: [{ launchId: 'tests', command: 'bun test', cwd: '/tmp/p1' }] };
        const held = await run(['start', 'tests']);
        expect(held[0]).toStartWith('refused\tlaunch-held\tTests runs only once a person approves it');
        expect(held[1]).toBe('held\ttests\tbun test\t/tmp/p1');
        startResult = { outcome: 'busy', busy: { projectId: 'p2', launchId: 'web', port: 5173 } };
        expect((await run(['restart', 'dev']))[0]).toBe('refused\tport-busy\tPort 5173 is taken by a launch of another project; nothing started');
    });

    test('stops a launch, and says when it was not running', async () => {
        expect(await run(['stop', 'dev'])).toEqual(['stopping\tdev\tDev\t1']);
        expect(await run(['stop', 'tests'])).toEqual(['note\tTests was not running']);
    });

    test('refuses on a machine that runs no launches', async () => {
        host = { ...host, launches: undefined } as unknown as CanvasHost;
        expect((await run(['list']))[0]).toBe('refused\tno-launches\tThis machine runs no launches');
    });
});

describe('the launches an agent reaches', () => {
    const resolved = (id: string, overrides: Partial<ResolvedLaunch> = {}): ResolvedLaunch => ({
        projectId: 'p1',
        folder: '/tmp/p1',
        launch: { id, name: id, kind: 'service' },
        shared: false,
        cwd: '/tmp/p1',
        command: `run ${id}`,
        env: {},
        url: null,
        port: null,
        approved: true,
        ...overrides
    });

    test('start as an agent, never approving on the way, and stop without a kill', async () => {
        const options: LaunchStartOptions[] = [];
        const stops: unknown[][] = [];
        const reached = agentLaunches(
            { resolveAll: async () => [] },
            {
                list: () => [],
                sessionOf: () => null,
                start: async (_projectId, _launchId, given) => {
                    options.push(given);
                    return { outcome: 'started' };
                },
                restart: async (_projectId, _launchId, given) => {
                    options.push(given);
                    return { outcome: 'started' };
                },
                stop: async (...args) => {
                    stops.push(args);
                    return 1;
                }
            },
            async () => null
        );
        await reached.start('p1', 'dev', false);
        await reached.start('p1', 'dev', true);
        await reached.stop('p1', 'dev');
        expect(options).toEqual([{ actor: 'agent' }, { actor: 'agent' }]);
        expect(stops).toEqual([['p1', 'dev']]);
    });

    test('a group is approved once every launch it starts is, and reads the state of this project only', async () => {
        const reached = agentLaunches(
            {
                resolveAll: async () => [
                    resolved('dev', { url: 'http://localhost:5173', port: 5173 }),
                    resolved('api', { approved: false }),
                    resolved('front', { launch: { id: 'front', name: 'Front', kind: 'group', launches: ['dev'] }, approved: false }),
                    resolved('all', { launch: { id: 'all', name: 'All', kind: 'group', launches: ['dev', 'api'] }, approved: false })
                ]
            },
            {
                list: () => [status('dev', { port: 5174 }), status('api', { projectId: 'p2' })],
                sessionOf: (_projectId, launchId) => (launchId === 'dev' ? 'launch:p1:dev' : null),
                start: async () => ({ outcome: 'started' }),
                restart: async () => ({ outcome: 'started' }),
                stop: async () => 0
            },
            async (sessionId) => `screen of ${sessionId}`
        );
        const list = await reached.list('p1');
        expect(list.map((launch) => [launch.launchId, launch.approved, launch.status?.state ?? null, launch.port])).toEqual([
            ['dev', true, 'running', 5174],
            ['api', false, null, null],
            ['front', true, null, null],
            ['all', false, null, null]
        ]);
        expect(await reached.text('p1', 'dev')).toBe('screen of launch:p1:dev');
        expect(await reached.text('p1', 'api')).toBeNull();
    });
});
