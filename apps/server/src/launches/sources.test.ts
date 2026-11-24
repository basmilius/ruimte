import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { LaunchConfigEntry } from '@ruimte/contracts';
import { checkCwd } from '../canvas/project-paths.ts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import { SessionManager } from '../sessions/manager.ts';
import { OPEN_BOUNDS } from '../sessions/open-bounds-test-helpers.ts';
import { TEST_GIT_BASH } from '../sessions/test-helpers.ts';
import type { SessionEvent } from '../wire.ts';
import { agentLaunches } from './agent-host.ts';
import { launchSessionIdOf, LaunchRunner } from './runner.ts';
import { managerSessions } from './sessions.ts';
import { LaunchSources, type LaunchSourceHost } from './sources.ts';
import { launchDigest, LaunchStore } from './store.ts';

type Listing = Awaited<ReturnType<LaunchSourceHost['list']>>[number];

const WEB = 'dev.harbor:compose:web';
const API = 'dev.harbor:compose:api';
const dev: LaunchConfigEntry = { id: 'dev', name: 'Dev', kind: 'service', command: 'bun run dev', shared: false };

let root: string;
let folder: string;
let adapter: FakePtyAdapter;
let manager: SessionManager;
let store: LaunchStore;
let sources: LaunchSources;
let runner: LaunchRunner;
let events: SessionEvent[];
// What the fake extension lists, and which of its sources the machine asked to tell of changes.
let listings: Listing[];
let watched: string[];
let lists: number;

function harbor(fingerprint: string, services: readonly string[] = ['web', 'api']): Listing {
    return {
        extension: 'dev.harbor',
        source: 'compose',
        title: 'Harbor',
        watches: true,
        launches: services.map((service, index) => ({
            id: service,
            name: service,
            kind: 'service',
            spawn: { command: 'sh', args: ['-c', `harbor up ${service}`], env: { HARBOR_SERVICE: service } },
            fingerprint,
            port: 8080 + index
        }))
    };
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-launch-sources-')));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });

    const approvals = new CommandApprovals(join(root, 'home'));

    await approvals.load();
    listings = [harbor('digest-1')];
    watched = [];
    lists = 0;
    sources = new LaunchSources({
        host: {
            list: async () => {
                lists += 1;

                return listings;
            },
            watch: async (extension, source, _project, watch) => {
                watched.push(`${watch ? 'watch' : 'unwatch'} ${extension}/${source}`);
            }
        },
        projectOf: async (projectId) => (projectId === 'p1' ? { id: 'p1', name: 'Shop', folder } : null),
        changed: (projectId) => store.sourcesChanged(projectId)
    });
    store = new LaunchStore({
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), worktreePaths: () => Promise.resolve([]) },
        approvals,
        seams: new FakeWatch(),
        sources
    });
    adapter = new FakePtyAdapter();
    manager = new SessionManager({ ...OPEN_BOUNDS, adapter, env: { PATH: '/usr/bin:/bin', HOME: root, SHELL: '/bin/zsh' }, findGitBash: () => TEST_GIT_BASH });

    const timers = new ManualTimers();

    runner = new LaunchRunner({
        store,
        sessions: managerSessions(manager, () => Promise.resolve(null)),
        checkCwd: (inside, cwd) => checkCwd(inside, cwd, () => Promise.resolve([])),
        clock: { now: () => timers.now, set: (run, ms) => timers.set(run, ms) },
        probe: () => Promise.resolve(true)
    });
    events = [];
    store.subscribe('c1', (event) => events.push(event));
});

afterEach(async () => {
    runner.close();
    store.closeAll();
    manager.killAll();
    await rm(root, { recursive: true, force: true });
});

/* What a source said changed, as its extension's process tells the machine. */
async function sourceChanged(next: Listing[]): Promise<void> {
    listings = next;
    await sources.refresh('p1');
}

describe('the launches a source of an extension lists', () => {
    test('show beside the launches of the files, in no file and with their source, and tell every client', async () => {
        await store.save('p1', 0, [dev]);

        expect((await store.resolveAll('p1')).map((resolved) => resolved.launch.id)).toEqual(['dev', WEB, API]);

        const document = await store.read('p1');

        expect(document.launches.map((launch) => launch.id)).toEqual(['dev']);
        expect(document.approved).toEqual(['dev']);
        expect(document.sourced).toEqual([
            {
                id: WEB,
                name: 'web',
                kind: 'service',
                command: "sh -c 'harbor up web'",
                env: { HARBOR_SERVICE: 'web' },
                url: 'http://localhost:8080',
                source: { extension: 'dev.harbor', id: 'compose', title: 'Harbor' }
            },
            expect.objectContaining({ id: API, url: 'http://localhost:8081' })
        ]);
        expect(watched).toEqual(['watch dev.harbor/compose']);

        const changed = events.filter((event) => event.event === 'launches.changed');

        expect(changed.at(-1)?.payload).toMatchObject({ projectId: 'p1', document: { sourced: [{ id: WEB }, { id: API }] } });
    });

    test('wait for a person, who approves one launch with its command, folder, variables and fingerprint', async () => {
        expect(await runner.start('p1', WEB, { actor: 'agent' })).toEqual({
            outcome: 'held',
            held: [
                {
                    launchId: WEB,
                    command: "sh -c 'harbor up web'",
                    cwd: folder,
                    env: { HARBOR_SERVICE: 'web' },
                    source: { extension: 'dev.harbor', id: 'compose', title: 'Harbor' }
                }
            ]
        });
        expect(adapter.spawned).toHaveLength(0);
        expect(await runner.start('p1', WEB, { actor: 'person', approve: true })).toEqual({ outcome: 'started' });

        const pty = adapter.forSession(launchSessionIdOf('p1', WEB));

        expect(pty.options.args.at(-1)).toBe("sh -c 'harbor up web'");
        expect(pty.options.cwd).toBe(folder);
        expect(pty.options.env.HARBOR_SERVICE).toBe('web');
        expect((await store.read('p1')).approved).toEqual([WEB]);
        expect(await runner.start('p1', API, { actor: 'agent' })).toMatchObject({ outcome: 'held' });
    });

    test('ask a person again once the fingerprint of what the source read changed, though the command stayed', async () => {
        await runner.start('p1', WEB, { actor: 'person', approve: true });
        await runner.stop('p1', WEB, { force: true });

        expect((await store.resolve('p1', WEB)).approved).toBe(true);

        await sourceChanged([harbor('digest-2')]);

        expect((await store.resolve('p1', WEB)).approved).toBe(false);
        expect((await store.read('p1')).approved).toEqual([]);
        expect(await runner.start('p1', WEB, { actor: 'agent' })).toMatchObject({ outcome: 'held', held: [{ launchId: WEB }] });

        // What was approved is the launch as the first file had it, so the first file approves it again.
        await sourceChanged([harbor('digest-1')]);

        expect((await store.resolve('p1', WEB)).approved).toBe(true);
    });

    test('are approved together for the whole source, as they stand, and one the source lists later asks again', async () => {
        await store.resolveAll('p1');
        await store.approveSource('p1', 'dev.harbor', 'compose');

        expect((await store.read('p1')).approved).toEqual([WEB, API]);

        await sourceChanged([harbor('digest-2', ['web', 'api', 'db'])]);

        expect((await store.read('p1')).approved).toEqual([]);

        await store.approveSource('p1', 'dev.harbor', 'another');

        expect((await store.read('p1')).approved).toEqual([]);
    });

    test('are read again before a start, so what starts is what the source reads now', async () => {
        await store.resolveAll('p1');
        await store.approveSource('p1', 'dev.harbor', 'compose');
        // The file changed and the source never said so.
        listings = [harbor('digest-2')];

        expect(await runner.start('p1', WEB, { actor: 'agent' })).toMatchObject({ outcome: 'held' });
        expect(adapter.spawned).toHaveLength(0);
    });

    test('approve through an answer for a launch as it was listed only while it still is that launch', async () => {
        const listed = launchDigest(await store.resolve('p1', WEB));

        await sourceChanged([harbor('digest-2')]);

        expect(await store.approveIfUnchanged('p1', WEB, listed)).toBe(false);
        expect(await store.approveIfUnchanged('p1', WEB, launchDigest(await store.resolve('p1', WEB)))).toBe(true);
    });

    test('are gone once their source stops listing them, and one that still runs can be stopped', async () => {
        await runner.start('p1', WEB, { actor: 'person', approve: true });
        await sourceChanged([]);

        expect((await store.read('p1')).sourced).toBeUndefined();
        await expect(store.resolve('p1', WEB)).rejects.toMatchObject({ code: 'launch-not-found' });
        expect(await runner.stop('p1', WEB)).toBe(1);
    });

    test('lose to a launch of the files under the same id, and never run after a chat settles', async () => {
        await store.save('p1', 0, [{ ...dev, id: WEB }]);

        expect((await store.resolveAll('p1')).map((resolved) => [resolved.launch.id, resolved.sourced === undefined])).toEqual([
            [WEB, true],
            [API, false]
        ]);
        await expect(store.inWorktree('p1', API, join(root, 'worktree'))).rejects.toMatchObject({ code: 'launch-not-a-task' });
    });

    test('read to an agent as launches with their source, held until a person approved them', async () => {
        const host = agentLaunches(store, runner, async () => null);

        expect((await host.list('p1')).map((launch) => [launch.launchId, launch.source, launch.approved, launch.port])).toEqual([
            [WEB, 'Harbor', false, 8080],
            [API, 'Harbor', false, 8081]
        ]);
        expect(await host.start('p1', WEB, false)).toMatchObject({ outcome: 'held' });

        await store.approveSource('p1', 'dev.harbor', 'compose');

        expect(await host.start('p1', WEB, false)).toEqual({ outcome: 'started' });
        expect(await host.entries('p1')).toEqual([]);
    });

    test('stop being followed when the project is let go of, and are asked for again when an extension changed', async () => {
        await store.resolveAll('p1');

        const before = lists;

        sources.extensionChanged('dev.harbor');
        await sources.settled('p1');

        expect(lists).toBe(before + 1);
        expect(watched).toEqual(['watch dev.harbor/compose', 'watch dev.harbor/compose']);

        store.closeProject('p1');

        expect(watched.at(-1)).toBe('unwatch dev.harbor/compose');
        expect(sources.listed('p1')).toEqual([]);
    });
});
