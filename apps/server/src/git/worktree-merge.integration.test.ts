import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn, initRepo } from './test-repo.ts';
import { STILL_WAITING, WorktreeMerge } from './worktree-merge.ts';
import { Worktrees } from './worktrees.ts';

let root: string;
let repo: string;
let pidFile: string;

/* Takes the hook down if the cancel under test did not, so no shell outlives the file. */
const killHook = async (): Promise<void> => {
    const pid = Number.parseInt((await readFile(pidFile, 'utf8').catch(() => '')).trim(), 10);
    if (Number.isFinite(pid)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // Gone already, which is what the cancel is for.
        }
    }
};

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-merge-cancel-')));
    repo = join(root, 'repo');
    pidFile = join(root, 'hook.pid');
    const fifo = join(root, 'hook.fifo');
    await initRepo(repo, { 'README.md': 'hi\n' });
    await gitIn(repo, ['config', 'user.name', 'Ada']);
    await gitIn(repo, ['config', 'user.email', 'a@a']);
    expect(await Bun.spawn(['mkfifo', fifo]).exited).toBe(0);
    // A pre-commit hook that waits on a pipe nobody ever writes to, the way a hung hook or a pinentry would.
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, `#!/bin/sh\necho $$ > '${pidFile}'\nread line < '${fifo}'\n`);
    await chmod(hook, 0o755);
});

afterEach(async () => {
    await killHook();
    await rm(root, { recursive: true, force: true });
});

test('cancel ends a step a hook holds up, after the merge said it is still waiting, and lets go of the repository', async () => {
    const worktrees = new Worktrees(join(root, 'home'));
    const { worktree } = await worktrees.add(repo, 'lexer', { madeBy: 'verb', nodeId: 'chat-lexer' });
    await writeFile(join(worktree.path, 'lexer.txt'), 'lexer\n');
    const merges = new WorktreeMerge(worktrees, { in: () => [], stop: async () => undefined }, { waitNotice: 50 });

    const { promise: waiting, resolve } = Promise.withResolvers<string>();
    const merging = merges.merge({ repo, path: worktree.path, actionId: 'merge-1', strategy: 'merge', commitFirst: true }, (phase, line) => {
        if (line === STILL_WAITING) {
            resolve(phase);
        }
    });

    expect(await waiting).toBe('commit');
    merges.cancel('merge-1');

    await expect(merging).rejects.toThrow('The merge was canceled.');
    expect(await worktrees.exclusive(repo, async () => 'free')).toBe('free');
    expect((await gitIn(repo, ['rev-list', '--count', 'main..lexer'])).trim()).toBe('0');
});
