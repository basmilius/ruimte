import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';
import { Worktrees } from './worktrees.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let worktrees: Worktrees;

const git = (args: string[]): Promise<string> => gitIn(repo, args);

beforeAll(async () => {
    template = await repoTemplate('ruimte-git', (dir) => initRepo(join(dir, 'repo'), { 'README.md': 'hi' }));
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    repo = join(root, 'repo');
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
