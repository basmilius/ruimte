import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchConfigEntry, LaunchStartResult, LaunchStatus } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { checkCwd } from '../canvas/project-paths.ts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import { SessionManager } from '../sessions/manager.ts';
import { launchSessionIdOf, LaunchRunner, PROBE_INTERVAL_MS, STOP_GRACE_MS } from './runner.ts';
import { managerSessions } from './sessions.ts';
import { LaunchStore } from './store.ts';

let root: string;
let folder: string;
let adapter: FakePtyAdapter;
let manager: SessionManager;
let store: LaunchStore;
let fake: FakeWatch;
let timers: ManualTimers;
let listening: Set<number>;
let runner: LaunchRunner;
let statuses: LaunchStatus[];

const server: LaunchConfigEntry = {
    id: 'run-server',
    name: 'Run server',
    kind: 'service',
    cwd: 'backend',
    command: 'php -S 0.0.0.0:8000 -t public',
    url: 'http://localhost:8000',
    env: { APP_ENV: 'development' },
    shared: true
};
const debug: LaunchConfigEntry = { ...server, id: 'debug-server', name: 'Debug server', command: 'php -dxdebug.mode=debug -S 0.0.0.0:8000 -t public' };
const tests: LaunchConfigEntry = { id: 'run-tests', name: 'Run tests', kind: 'task', cwd: 'backend', command: 'vendor/bin/pest', shared: false };
const dev: LaunchConfigEntry = { id: 'dev', name: 'Dev', kind: 'service', command: 'bun run dev', url: 'http://localhost:5173', shared: true };
const stack: LaunchConfigEntry = { id: 'stack', name: 'Full stack', kind: 'group', launches: ['run-server', 'dev'], shared: true };

function ptyOf(launchId: string) {
    return adapter.forSession(launchSessionIdOf('p1', launchId));
}
function lastOf(launchId: string): LaunchStatus | undefined {
    return statuses.findLast((status) => status.launchId === launchId);
}
// Lets the promises a step started settle, the exit a signal causes among them.
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
    await Bun.sleep(0);
}
// For a step behind file reads, which take as long as the disk does: a cap on the turns would race a slow runner.
async function until(done: () => boolean): Promise<void> {
    while (!done()) {
        await flush();
    }
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-runner-')));
    folder = join(root, 'repo');
    await mkdir(join(folder, 'backend'), { recursive: true });
    const approvals = new CommandApprovals(join(root, 'home'));
    await approvals.load();
    fake = new FakeWatch();
    store = new LaunchStore({
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), worktreePaths: () => Promise.resolve([]) },
        approvals,
        seams: fake
    });
    adapter = new FakePtyAdapter();
    manager = new SessionManager({ adapter, env: { PATH: '/usr/bin:/bin', HOME: root, SHELL: '/bin/zsh' } });
    timers = new ManualTimers();
    listening = new Set();
    runner = new LaunchRunner({
        store,
        sessions: managerSessions(manager, () => Promise.resolve(null)),
        checkCwd: (inside, cwd) => checkCwd(inside, cwd, () => Promise.resolve([])),
        clock: { now: () => timers.now, set: (run, ms) => timers.set(run, ms) },
        probe: (_host, port) => Promise.resolve(listening.has(port))
    });
    statuses = [];
    runner.subscribe('c1', (event) => {
        if (event.event === 'launch.status') {
            statuses.push(event.payload);
        }
    });
});

afterEach(async () => {
    runner.close();
    store.closeAll();
    manager.killAll();
    await rm(root, { recursive: true, force: true });
});

describe('LaunchRunner', () => {
    test('a service runs its command as the argument of a login shell and runs once its port answers', async () => {
        await store.save('p1', 0, [server]);
        expect(await runner.start('p1', 'run-server', { actor: 'person' })).toEqual({ outcome: 'started' });
        const pty = ptyOf('run-server');
        expect(pty.options.args).toEqual(['-l', '-i', '-c', server.command!]);
        expect(pty.options.cwd).toBe(join(folder, 'backend'));
        expect(pty.options.env.APP_ENV).toBe('development');
        expect(pty.typed).toBe('');
        await flush();
        expect(lastOf('run-server')?.state).toBe('starting');

        listening.add(8000);
        timers.advance(PROBE_INTERVAL_MS);
        await flush();
        expect(lastOf('run-server')).toMatchObject({ state: 'running', port: 8000, url: 'http://localhost:8000', stopped: false });
        expect(runner.labelOf(launchSessionIdOf('p1', 'run-server'))).toBe('Run server');
    });

    test('a task runs at once and ends with the exit code of its command', async () => {
        await store.save('p1', 0, [tests]);
        await runner.start('p1', 'run-tests', { actor: 'person' });
        expect(lastOf('run-tests')?.state).toBe('running');
        timers.advance(1_500);
        ptyOf('run-tests').exit(1);
        await flush();
        expect(lastOf('run-tests')).toMatchObject({ state: 'exited', exitCode: 1, endedAt: timers.now, stopped: false });
        expect(runner.list().map((status) => status.state)).toEqual(['exited']);
    });

    test('a changed command is held until a person approves it, and an agent cannot', async () => {
        await store.save('p1', 0, [server]);
        const path = join(folder, '.ruimte', 'launches.json');
        const file = JSON.parse(await readFile(path, 'utf8'));
        file.launches[0].command = 'php -S 0.0.0.0:8000 -t web';
        await writeFile(path, JSON.stringify(file));
        fake.on(join(folder, '.ruimte')).emit('launches.json');
        await fake.settle();

        const held: LaunchStartResult = {
            outcome: 'held',
            held: [{ launchId: 'run-server', command: 'php -S 0.0.0.0:8000 -t web', cwd: join(folder, 'backend'), env: { APP_ENV: 'development' } }]
        };
        expect(await runner.start('p1', 'run-server', { actor: 'agent', approve: true })).toEqual(held);
        expect(await runner.start('p1', 'run-server', { actor: 'person' })).toEqual(held);
        expect(adapter.spawned).toHaveLength(0);

        expect(await runner.start('p1', 'run-server', { actor: 'person', approve: true })).toEqual({ outcome: 'started' });
        expect((await store.read('p1')).approved).toEqual(['run-server']);
    });

    test('a launch held for a change to its variables alone names those variables', async () => {
        await store.save('p1', 0, [server]);
        const path = join(folder, '.ruimte', 'launches.json');
        const file = JSON.parse(await readFile(path, 'utf8'));
        file.launches[0].env = { PATH: './shim:/usr/bin', NODE_OPTIONS: '--require ./hook.js' };
        await writeFile(path, JSON.stringify(file));
        fake.on(join(folder, '.ruimte')).emit('launches.json');
        await fake.settle();

        expect(await runner.start('p1', 'run-server', { actor: 'person' })).toEqual({
            outcome: 'held',
            held: [
                {
                    launchId: 'run-server',
                    command: server.command!,
                    cwd: join(folder, 'backend'),
                    env: { PATH: './shim:/usr/bin', NODE_OPTIONS: '--require ./hook.js' }
                }
            ]
        });
    });

    test('a folder outside the project is refused before anything runs', async () => {
        await mkdir(join(root, 'outside'));
        await store.save('p1', 0, [tests]);
        const path = join(folder, '.ruimte', 'private', 'launches.json');
        const file = JSON.parse(await readFile(path, 'utf8'));
        file.launches[0].cwd = '../outside';
        await writeFile(path, JSON.stringify(file));
        fake.on(join(folder, '.ruimte', 'private')).emit('launches.json');
        await fake.settle();

        await expect(runner.start('p1', 'run-tests', { actor: 'person', approve: true })).rejects.toMatchObject({ code: 'cwd-outside-project' });
        expect(adapter.spawned).toHaveLength(0);
        expect((await store.read('p1')).approved).toEqual([]);
    });

    test('a stop is Ctrl+C first and SIGTERM after the grace period', async () => {
        await store.save('p1', 0, [server]);
        await runner.start('p1', 'run-server', { actor: 'agent' });
        const pty = ptyOf('run-server');
        expect(await runner.stop('p1', 'run-server')).toBe(1);
        expect(pty.typed).toBe('\x03');
        expect(pty.signals).toEqual([]);
        expect(lastOf('run-server')).toMatchObject({ state: 'stopping', stopped: true });

        timers.advance(STOP_GRACE_MS);
        await flush();
        expect(pty.signals).toEqual(['SIGTERM']);
        expect(lastOf('run-server')).toMatchObject({ state: 'exited', stopped: true });
    });

    test('a force stop is SIGKILL at once', async () => {
        await store.save('p1', 0, [server]);
        await runner.start('p1', 'run-server', { actor: 'person' });
        await runner.stop('p1', 'run-server', { force: true });
        await flush();
        expect(ptyOf('run-server').signals).toEqual(['SIGKILL']);
        expect(lastOf('run-server')?.state).toBe('exited');
        expect(timers.waiting).toBe(0);
    });

    test('a port another launch holds is busy, and replace stops that one first', async () => {
        await store.save('p1', 0, [server, debug]);
        await runner.start('p1', 'run-server', { actor: 'person' });
        expect(await runner.start('p1', 'debug-server', { actor: 'person' })).toEqual({
            outcome: 'busy',
            busy: { projectId: 'p1', launchId: 'run-server', port: 8000 }
        });

        const replacing = runner.start('p1', 'debug-server', { actor: 'person', replace: true });
        await until(() => ptyOf('run-server').typed !== '');
        expect(ptyOf('run-server').typed).toBe('\x03');
        ptyOf('run-server').exit(130);
        expect(await replacing).toEqual({ outcome: 'started' });
        expect(lastOf('run-server')).toMatchObject({ state: 'exited', exitCode: 130, stopped: true });
        expect(lastOf('debug-server')?.state).toBe('starting');
    });

    test('a group starts what it holds, skips what already runs, and stops it all', async () => {
        await store.save('p1', 0, [server, dev, stack]);
        await runner.start('p1', 'run-server', { actor: 'person' });
        await runner.start('p1', 'stack', { actor: 'person' });
        expect(adapter.spawned.map((pty) => pty.options.args.at(-1))).toEqual([server.command, dev.command]);

        expect(await runner.stop('p1', 'stack', { force: true })).toBe(2);
        await flush();
        expect(runner.list().map((status) => status.state)).toEqual(['exited', 'exited']);
    });

    test('a restart stops the launch and starts it on an empty screen', async () => {
        await store.save('p1', 0, [tests]);
        await runner.start('p1', 'run-tests', { actor: 'person' });
        ptyOf('run-tests').emit('first run\r\n');
        const restarting = runner.restart('p1', 'run-tests', { actor: 'person' });
        await until(() => ptyOf('run-tests').typed !== '');
        ptyOf('run-tests').exit(130);
        expect(await restarting).toEqual({ outcome: 'started' });
        expect(adapter.spawned).toHaveLength(2);
        const session = manager.get(launchSessionIdOf('p1', 'run-tests'))!;
        expect(await session.plainText()).not.toContain('first run');
        expect(lastOf('run-tests')).toMatchObject({ state: 'running', stopped: false, exitCode: null });
    });

    test('opening the project starts the approved launches marked autostart, once', async () => {
        await store.save('p1', 0, [
            { ...tests, autostart: true },
            { ...dev, autostart: false }
        ]);
        await runner.opened('p1');
        await runner.opened('p1');
        expect(adapter.spawned.map((pty) => pty.options.args.at(-1))).toEqual([tests.command]);
    });

    test('a launch that is not approved does not start with the project', async () => {
        await store.save('p1', 0, [{ ...tests, autostart: true }]);
        const path = join(folder, '.ruimte', 'private', 'launches.json');
        const file = JSON.parse(await readFile(path, 'utf8'));
        file.launches[0].command = 'rm -rf build';
        await writeFile(path, JSON.stringify(file));
        fake.on(join(folder, '.ruimte', 'private')).emit('launches.json');
        await fake.settle();
        await runner.opened('p1');
        expect(adapter.spawned).toHaveLength(0);
    });

    test('closing the project ends its launches and forgets them', async () => {
        await store.save('p1', 0, [server, tests]);
        await runner.start('p1', 'run-server', { actor: 'person' });
        await runner.start('p1', 'run-tests', { actor: 'person' });
        ptyOf('run-tests').exit(0);
        await flush();
        expect(runner.running('p1')).toBe(1);
        expect(await runner.end('p1')).toBe(1);
        expect(runner.list()).toEqual([]);
        expect(manager.list()).toEqual([]);
    });
});
