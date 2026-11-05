import { beforeEach, describe, expect, test } from 'bun:test';
import { LAUNCH_SECRET_REFERENCE, type LaunchConfig, type LaunchConfigEntry, type LaunchStartResult, type LaunchStatus } from '@ruimte/contracts';
import type { CanvasHost, LaunchHost, LaunchReading } from '../canvas/host.ts';
import { agentLaunches } from '../launches/agent-host.ts';
import type { LaunchStartOptions } from '../launches/runner.ts';
import type { ResolvedLaunch } from '../launches/store.ts';
import { launchToolkit } from './launch-tools.ts';
import { launchReading as reading, toolAnswer, toolCall } from './tool-test-helpers.ts';

function status(launchId: string, overrides: Partial<LaunchStatus> = {}): LaunchStatus {
    return {
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
    };
}

let launches: LaunchReading[];
let entries: LaunchConfigEntry[];
let saves: Array<{ launch: LaunchConfig; shared: boolean }>;
let startResult: LaunchStartResult;
let calls: string[];
let host: CanvasHost;

async function unused(): Promise<never> {
    throw new Error('not reached in this test');
}

function launchHost(): LaunchHost {
    return {
        entries: async () => entries,
        save: async (_projectId, launch, shared) => {
            saves.push({ launch, shared });
        },
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
    };
}

beforeEach(() => {
    launches = [
        reading('dev', { name: 'Dev', url: 'http://localhost:5173', port: 5173, status: status('dev') }),
        reading('tests', { name: 'Tests', kind: 'task', approved: false, status: status('tests', { kind: 'task', state: 'exited', exitCode: 1, port: null }) }),
        reading('stack', { name: 'Full stack', kind: 'group', approved: false, members: ['dev', 'tests'] })
    ];
    entries = [
        { id: 'dev', name: 'Dev', kind: 'service', command: 'bun dev', url: 'http://localhost:5173', env: { TOKEN: LAUNCH_SECRET_REFERENCE }, shared: true },
        { id: 'tests', name: 'Tests', kind: 'task', command: 'bun test', env: { CI: '1' }, shared: false, watch: true } as LaunchConfigEntry,
        { id: 'stack', name: 'Full stack', kind: 'group', launches: ['dev', 'tests'], shared: false }
    ];
    saves = [];
    startResult = { outcome: 'started' };
    calls = [];
    host = {
        projects: { locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: '/tmp/p1', canvasId: 'main' } : null) },
        launches: launchHost()
    } as unknown as CanvasHost;
});

async function call(name: string, input: Record<string, unknown> = {}): Promise<string[]> {
    return (await toolAnswer(name, input, toolCall('chat-1', host))).lines;
}

describe('the launch tools', () => {
    test('lists every launch with its state and whether a person approved it', async () => {
        expect(await call('launch_list')).toEqual([
            'dev\tDev\tservice\trunning\tyes\t5173\thttp://localhost:5173\t-',
            'tests\tTests\ttask\texited:1\tno\t-\t-\t-',
            'stack\tFull stack\tgroup\t-\tno\t-\t-\tdev,tests'
        ]);
        launches = [];
        expect(await call('launch_list')).toEqual([
            'note\tThis project has no launches; a person adds them from the launch chip in the toolbar, and launch_new adds one they approve'
        ]);
    });

    test('reads the output by id or by name, and says when it never ran', async () => {
        expect(await call('launch_read', { launch: 'Dev', tail: 2 })).toEqual(['two', 'three']);
        expect(await call('launch_read', { launch: 'tests' })).toEqual(['note\tTests has not run since this machine started']);
        expect((await call('launch_read', { launch: 'stack' }))[0]).toStartWith('refused\tlaunch-group\t');
    });

    test('names what it has when a launch is unknown or its name is not unique', async () => {
        expect(await call('launch_read', { launch: 'web' })).toEqual([
            'refused\tunknown-launch\tThis project has no launch web',
            'launch\tdev\tDev',
            'launch\ttests\tTests',
            'launch\tstack\tFull stack'
        ]);
        launches = [...launches, reading('dev-2', { name: 'Dev' })];
        expect((await call('launch_control', { action: 'start', launch: 'dev' }))[0]).toBe('started\tdev\tDev');
        expect(await call('launch_control', { action: 'start', launch: 'Dev' })).toEqual([
            'refused\tambiguous-launch\t2 launches are called Dev; name one by its id',
            'launch\tdev\tDev',
            'launch\tdev-2\tDev'
        ]);
    });

    test('starts and restarts an approved launch', async () => {
        expect(await call('launch_control', { action: 'start', launch: 'dev' })).toEqual([
            'started\tdev\tDev',
            'see\tlaunch_list\twhether it came up; launch_read with launch dev for its output'
        ]);
        expect((await call('launch_control', { action: 'restart', launch: 'Full stack' }))[0]).toBe('restarted\tstack\tFull stack\tdev,tests');
        expect(calls).toEqual(['start dev', 'restart stack']);
    });

    test('refuses a launch nobody approved here, and one whose port is taken', async () => {
        startResult = { outcome: 'held', held: [{ launchId: 'tests', command: 'bun test', cwd: '/tmp/p1' }] };
        const held = await call('launch_control', { action: 'start', launch: 'tests' });

        expect(held[0]).toStartWith('refused\tlaunch-held\tTests runs only once a person approves it');
        expect(held[1]).toBe('held\ttests\tbun test\t/tmp/p1');

        startResult = { outcome: 'busy', busy: { projectId: 'p2', launchId: 'web', port: 5173 } };
        expect((await call('launch_control', { action: 'restart', launch: 'dev' }))[0]).toBe(
            'refused\tport-busy\tPort 5173 is taken by a launch of another project; nothing started'
        );
    });

    test('stops a launch, and says when it was not running', async () => {
        launches.push(reading('lint', { name: 'Lint', kind: 'task' }));
        expect(await call('launch_control', { action: 'stop', launch: 'dev' })).toEqual(['stopping\tdev\tDev\t1']);
        expect(await call('launch_control', { action: 'stop', launch: 'lint' })).toEqual(['note\tLint was not running']);
    });

    test('a launch that is not approved as it stands now is not stopped either', async () => {
        expect((await call('launch_control', { action: 'stop', launch: 'tests' }))[0]).toBe(
            'refused\tlaunch-held\tTests is stopped only once a person approves it on this machine as it stands now; the launch chip in the toolbar asks them'
        );
        expect((await call('launch_control', { action: 'stop', launch: 'stack' }))[0]).toStartWith('refused\tlaunch-held\tFull stack is stopped only once');
        expect(calls).toEqual([]);
    });

    test('refuses on a machine that runs no launches', async () => {
        host = { ...host, launches: undefined } as unknown as CanvasHost;
        expect((await call('launch_list'))[0]).toBe('refused\tno-launches\tThis machine runs no launches');
    });
});

describe('launch_new and launch_edit', () => {
    test('a new launch gets an id of its own name, goes in the private file, and waits on a person', async () => {
        const lines = await call('launch_new', {
            name: 'Dev',
            kind: 'service',
            command: 'bun run dev',
            url: 'http://localhost:3000',
            env: '{"PORT":"3000"}'
        });

        expect(lines).toEqual([
            'saved\tdev-2\tDev\tservice\tprivate',
            'held\tIt waits for a person to approve it from the launch chip in the toolbar, and starts nothing until then; tell them what you set up and why'
        ]);
        expect(saves).toEqual([
            {
                launch: { id: 'dev-2', name: 'Dev', kind: 'service', command: 'bun run dev', url: 'http://localhost:3000', env: { PORT: '3000' } },
                shared: false
            }
        ]);
    });

    test('shared puts a new one in the shared file, and a group names its launches by id', async () => {
        await call('launch_new', { name: 'Everything', kind: 'group', members: 'Dev, tests', shared: true });
        expect(saves).toEqual([{ launch: { id: 'everything', name: 'Everything', kind: 'group', launches: ['dev', 'tests'] }, shared: true }]);
    });

    test('a field the kind has not and a launch without a command are refused before anything is saved', async () => {
        expect((await call('launch_new', { name: 'Lint', kind: 'task', command: 'bun lint', url: 'http://x' }))[0]).toBe(
            'refused\twrong-kind\tA task takes no url'
        );
        expect((await call('launch_new', { name: 'Lint', kind: 'task' }))[0]).toStartWith('refused\tcommand-required\t');
        expect((await call('launch_new', { name: 'Lint', kind: 'task', command: 'x', env: '[1]' }))[0]).toStartWith('refused\t');
        expect(saves).toEqual([]);
    });

    test('an edit changes what it names in place, keeps the rest and its file, and asks the person again', async () => {
        expect(await call('launch_edit', { launch: 'Tests', command: 'bun test --bail', env: '{"CI":null,"DEBUG":"1"}' })).toEqual([
            'saved\ttests\tTests\ttask\tprivate',
            'held\tIt waits for a person to approve it from the launch chip in the toolbar, and starts nothing until then; tell them what you set up and why'
        ]);
        expect(saves).toEqual([
            {
                launch: { id: 'tests', name: 'Tests', kind: 'task', command: 'bun test --bail', env: { DEBUG: '1' }, watch: true } as LaunchConfig,
                shared: false
            }
        ]);

        await call('launch_edit', { launch: 'dev', name: 'Web' });
        expect(saves[1]).toEqual({
            launch: { id: 'dev', name: 'Web', kind: 'service', command: 'bun dev', url: 'http://localhost:5173', env: { TOKEN: LAUNCH_SECRET_REFERENCE } },
            shared: true
        });
    });

    test('a variable that holds a secret stays the person’s, and an unknown launch is named among what there is', async () => {
        expect((await call('launch_edit', { launch: 'dev', env: '{"TOKEN":"guess"}' }))[0]).toStartWith('refused\tsecret-variable\tTOKEN holds a secret');
        expect((await call('launch_edit', { launch: 'nope', name: 'X' }))[0]).toBe('refused\tunknown-launch\tThis project has no launch nope');
        expect(saves).toEqual([]);
    });

    test('no tool approves a launch', () => {
        expect(launchToolkit.tools.map((tool) => tool.name)).toEqual(['launch_list', 'launch_read', 'launch_new', 'launch_edit', 'launch_control']);
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
            { resolveAll: async () => [], read: unused, saveByAgent: unused },
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
                read: unused,
                saveByAgent: unused,
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
