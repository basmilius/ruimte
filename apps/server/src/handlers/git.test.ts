import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import { Dispatcher } from '../dispatcher.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { initRepo } from '../git/test-repo.ts';
import { registerGitHandlers } from './git.ts';

let root: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-handlers-')));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test('a client that closed while its git.watch was set up leaves no watcher behind', async () => {
    const repo = join(root, 'repo');
    await initRepo(repo, { 'a.txt': 'a\n' });
    const fake = new FakeWatch();
    const statuses = new GitStatusWatcher('darwin', fake);
    const dispatcher = new Dispatcher();
    registerGitHandlers(dispatcher, {} as never, {} as never, statuses, {} as never);
    const client = { id: 'phone', closed: false, send: (_frame: ServerFrame) => undefined };

    const handled = dispatcher.handle(client, JSON.stringify({ id: 'watch', type: 'git.watch', payload: { cwd: repo } }));
    // The socket goes before git answered, and its cleanup ran with nothing to clean yet.
    client.closed = true;
    statuses.detachAll('phone');
    await handled;

    expect(fake.openOn(repo)).toHaveLength(0);
});
