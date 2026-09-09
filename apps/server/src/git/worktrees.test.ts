import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worktrees } from './worktrees.ts';

let root: string;
let repo: string;
let worktrees: Worktrees;

const git = async (args: string[]): Promise<void> => {
    const proc = Bun.spawn(['git', ...args], {
        cwd: repo,
        stdout: 'ignore',
        stderr: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    });
    if ((await proc.exited) !== 0) {
        throw new Error(await new Response(proc.stderr).text());
    }
};

beforeEach(async () => {
    // Git reports real paths, and the temp dir sits behind a symlink on macOS (/var to /private/var).
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-')));
    repo = join(root, 'repo');
    await mkdir(repo);
    await git(['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'README.md'), 'hi');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
    worktrees = new Worktrees(join(root, 'home'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('Worktrees', () => {
    test('adds a worktree for a new branch under the app data dir, lists it, answers the same one again, removes it', async () => {
        const added = await worktrees.add(repo, 'feature/x');
        expect(added.created).toBe(true);
        expect(added.worktree.branch).toBe('feature/x');
        expect(added.worktree.path.startsWith(join(root, 'home', 'worktrees'))).toBe(true);
        expect((await stat(join(added.worktree.path, 'README.md'))).isFile()).toBe(true);

        expect(await worktrees.list(repo)).toEqual([added.worktree]);
        expect(await worktrees.add(join(repo, 'sub-path-does-not-matter').replace('/sub-path-does-not-matter', ''), 'feature/x')).toEqual({
            worktree: added.worktree,
            created: false
        });

        await worktrees.remove(repo, added.worktree.path);
        expect(await worktrees.list(repo)).toEqual([]);
        await expect(worktrees.remove(repo, added.worktree.path)).rejects.toMatchObject({ code: 'worktree-not-found' });
    });

    test('an existing branch gets a worktree without a new branch', async () => {
        await git(['branch', 'existing']);
        const added = await worktrees.add(repo, 'existing');
        expect(added.created).toBe(true);
        expect((await worktrees.list(repo)).map((entry) => entry.branch)).toEqual(['existing']);
    });

    test('a folder outside a repository is refused', async () => {
        await expect(worktrees.add(root, 'x')).rejects.toMatchObject({ code: 'not-a-repo' });
    });
});
