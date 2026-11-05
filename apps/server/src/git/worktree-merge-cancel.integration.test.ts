import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processAlive } from '../process-test-helpers.ts';
import { expectProcessTerminated, installHangingHook, killFromPidFile } from './test-process.ts';
import { gitIn, initRepo, NO_WORKTREE_AGENTS } from './test-repo.ts';
import { STILL_WAITING, WorktreeMerge } from './worktree-merge.ts';
import { Worktrees } from './worktrees.ts';

let root: string;
let repo: string;
let pidFile: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-merge-cancel-')));
    repo = join(root, 'repo');
    pidFile = join(root, 'hook.pid');
    await initRepo(repo, { 'README.md': 'hi\n' });
    await installHangingHook(repo, pidFile, 'hook-ready');
});

afterEach(async () => {
    await killFromPidFile(pidFile);
    await rm(root, { recursive: true, force: true });
});

test('cancel ends a step a hook holds up, after the merge said it is still waiting, and lets go of the repository', async () => {
    const worktrees = new Worktrees(join(root, 'home'), NO_WORKTREE_AGENTS);
    const { worktree } = await worktrees.add(repo, 'lexer', { madeBy: 'verb', nodeId: 'chat-lexer' });
    await writeFile(join(worktree.path, 'lexer.txt'), 'lexer\n');
    const merges = new WorktreeMerge(worktrees, { in: () => [], stop: async () => undefined }, { waitNotice: 50 });

    const { promise: waiting, resolve } = Promise.withResolvers<string>();
    const ready = Promise.withResolvers<void>();
    const merging = merges.merge({ repo, path: worktree.path, actionId: 'merge-1', strategy: 'merge', commitFirst: true }, (phase, line) => {
        // A slow runner can outlast the notice on `git add` too; only the hook's step is under test.
        if (line === STILL_WAITING && phase === 'commit') {
            resolve(phase);
        }
        if (line === 'hook-ready' && phase === 'commit') {
            ready.resolve();
        }
    });

    expect(await waiting).toBe('commit');
    await ready.promise;
    const pid = Number.parseInt(await readFile(pidFile, 'utf8'), 10);
    expect(Number.isSafeInteger(pid)).toBe(true);
    expect(processAlive(pid)).toBe(true);
    merges.cancel('merge-1');

    await expect(merging).rejects.toThrow('The merge was canceled.');
    await expectProcessTerminated(pid, 'SIGTERM');
    expect(await worktrees.exclusive(repo, async () => 'free')).toBe('free');
    expect((await gitIn(repo, ['rev-list', '--count', 'main..lexer'])).trim()).toBe('0');
});
