import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processAlive } from '../process-test-helpers.ts';
import { GitActions } from './actions.ts';
import { expectProcessTerminated, installHangingHook, killFromPidFile } from './process-test-helpers.ts';
import { gitIn, initRepo } from './test-repo.ts';

let root: string;
let repo: string;
let pidFile: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-action-cancel-')));
    repo = join(root, 'repo');
    pidFile = join(root, 'hook.pid');
    await initRepo(repo, { 'README.md': 'hi\n' });
    await installHangingHook(repo, pidFile, 'waiting');
});

afterEach(async () => {
    await killFromPidFile(pidFile);
    await rm(root, { recursive: true, force: true });
});

test('cancel ends a commit a hook holds up, the hook included', async () => {
    const before = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(repo, 'two.txt'), 'two\n');
    const actions = new GitActions();
    const { promise: waiting, resolve } = Promise.withResolvers<void>();
    const committing = actions.run({ cwd: repo, actionId: 'commit-1', kind: 'commit', subject: 'two', stageAll: true }, (phase, line) => {
        if (phase === 'commit' && line === 'waiting') {
            resolve();
        }
    });

    await waiting;
    const pid = Number.parseInt(await readFile(pidFile, 'utf8'), 10);
    expect(Number.isSafeInteger(pid)).toBe(true);
    expect(processAlive(pid)).toBe(true);
    actions.cancel('commit-1');

    await expect(committing).rejects.toThrow('The action was canceled.');
    await expectProcessTerminated(pid, 'SIGTERM');
    expect((await gitIn(repo, ['rev-parse', 'HEAD'])).trim()).toBe(before);
});
