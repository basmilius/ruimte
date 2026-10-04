import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitActions } from './actions.ts';
import { gitIn, initRepo } from './test-repo.ts';

let root: string;
let repo: string;
let pidFile: string;

/* Takes the hook down if the cancel under test did not, so no shell outlives the file. */
async function killHook(): Promise<void> {
    const pid = Number.parseInt((await readFile(pidFile, 'utf8').catch(() => '')).trim(), 10);
    if (Number.isFinite(pid)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // Gone already, which is what the cancel is for.
        }
    }
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-action-cancel-')));
    repo = join(root, 'repo');
    pidFile = join(root, 'hook.pid');
    const fifo = join(root, 'hook.fifo');
    await initRepo(repo, { 'README.md': 'hi\n' });
    await gitIn(repo, ['config', 'user.name', 'Ada']);
    await gitIn(repo, ['config', 'user.email', 'a@a']);
    expect(await Bun.spawn(['mkfifo', fifo]).exited).toBe(0);
    // A pre-commit hook that waits on a pipe nobody ever writes to, the way a hung hook or ssh would.
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, `#!/bin/sh\necho $$ > '${pidFile}'\necho waiting\nread line < '${fifo}'\n`);
    await chmod(hook, 0o755);
});

afterEach(async () => {
    await killHook();
    await rm(root, { recursive: true, force: true });
});

test('cancel ends a commit a hook holds up, the hook included', async () => {
    await writeFile(join(repo, 'two.txt'), 'two\n');
    const actions = new GitActions();
    const { promise: waiting, resolve } = Promise.withResolvers<void>();
    const committing = actions.run({ cwd: repo, actionId: 'commit-1', kind: 'commit', subject: 'two', stageAll: true }, (phase, line) => {
        if (phase === 'commit' && line === 'waiting') {
            resolve();
        }
    });

    await waiting;
    actions.cancel('commit-1');

    await expect(committing).rejects.toThrow('The action was canceled.');
});
