import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchStatus } from '@ruimte/contracts';
import { checkCwd } from '../canvas/project-paths.ts';
import { foregroundGroup } from '../processes/foreground.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import { SessionManager } from '../sessions/manager.ts';
import { waitFor } from '../sessions/test-helpers.ts';
import { LaunchRunner } from './runner.ts';
import { managerSessions } from './sessions.ts';
import { LaunchStore } from './store.ts';

/*
 * What no fake can prove: that a real login shell runs the command, that a real port answers the
 * probe, and that Ctrl+C in the terminal reaches the server behind the shell.
 */

let root: string;
let manager: SessionManager;
let store: LaunchStore;
let runner: LaunchRunner;
let statuses: LaunchStatus[];

function freePort(): number {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = probe.port!;
    probe.stop(true);
    return port;
}

function lastOf(launchId: string): LaunchStatus | undefined {
    return statuses.findLast((status) => status.launchId === launchId);
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-launch-')));
    const approvals = new CommandApprovals(join(root, 'home'));
    await approvals.load();
    store = new LaunchStore({
        projects: { folderOf: () => root, worktreePaths: () => Promise.resolve([]) },
        approvals
    });
    // A home of its own, so the profile a login shell reads is empty.
    manager = new SessionManager({ adapter: new BunPtyAdapter(), env: { PATH: '/usr/bin:/bin', HOME: root, SHELL: '/bin/bash' } });
    runner = new LaunchRunner({
        store,
        sessions: managerSessions(manager, foregroundGroup),
        checkCwd: (folder, cwd) => checkCwd(folder, cwd, () => Promise.resolve([]))
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
    await waitFor(() => manager.list().every((session) => session.exited), 'every shell to exit').catch(() => undefined);
    await rm(root, { recursive: true, force: true });
});

describe('a launch in a real shell', () => {
    test('a server runs once its port answers and stops on Ctrl+C', async () => {
        const port = freePort();
        const command = `'${process.execPath}' -e 'Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); console.log("listening")'`;
        await store.save('p1', 0, [{ id: 'serve', name: 'Serve', kind: 'service', command, url: `http://localhost:${port}`, shared: false }]);

        expect(await runner.start('p1', 'serve', { actor: 'person' })).toEqual({ outcome: 'started' });
        await waitFor(() => lastOf('serve')?.state === 'running', 'the server to answer', 10_000);
        expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('ok');

        await runner.stop('p1', 'serve');
        await waitFor(() => lastOf('serve')?.state === 'exited', 'the server to stop', 10_000);
        expect(lastOf('serve')?.stopped).toBe(true);
    });

    test('a task ends with the exit code of its command', async () => {
        await store.save('p1', 0, [{ id: 'fail', name: 'Fail', kind: 'task', command: 'echo failing; exit 3', shared: false }]);
        await runner.start('p1', 'fail', { actor: 'person' });
        await waitFor(() => lastOf('fail')?.state === 'exited', 'the task to end', 10_000);
        expect(lastOf('fail')).toMatchObject({ exitCode: 3, stopped: false });
    });
});
