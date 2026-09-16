import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffCheckout, diffFile } from './diff.ts';
import { forgetBase, mergeBaseWith } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';
import { Worktrees } from './worktrees.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let worktrees: Worktrees;

beforeAll(async () => {
    // `feature` is one commit ahead of `main`, and the checkout stands on it.
    template = await repoTemplate('ruimte-worktree-diff', async (dir) => {
        const at = join(dir, 'repo');
        await initRepo(at, { 'README.md': 'hi\n' });
        await gitIn(at, ['checkout', '--quiet', '-b', 'feature']);
        await writeFile(join(at, 'feature.txt'), 'feature\n');
        await gitIn(at, ['add', '.']);
        await gitIn(at, ['commit', '--quiet', '--message', 'feature']);
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    forgetBase();
    root = await template.copy();
    repo = join(root, 'repo');
    worktrees = new Worktrees(join(root, 'home'), () => 1);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('a worktree against the branch it was made from', () => {
    test('shows its own commits, changes and new files, and none of the commits its branch had before it', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        expect(worktree.from?.branch).toBe('feature');
        await writeFile(join(worktree.path, 'lexer.txt'), 'lexer\n');
        await gitIn(worktree.path, ['add', '.']);
        await gitIn(worktree.path, ['commit', '--quiet', '--message', 'lexer']);
        await writeFile(join(worktree.path, 'README.md'), 'changed\n');
        await writeFile(join(worktree.path, 'new.txt'), 'new\n');

        const own = await diffCheckout(worktree.path, await mergeBaseWith(worktree.path, 'feature'));
        expect(own.files?.map((file) => file.path).sort()).toEqual(['README.md', 'lexer.txt', 'new.txt']);
        expect(own.files?.find((file) => file.path === 'new.txt')?.diff).toContain('+new');

        // The repository's base branch is main, which would count the feature commit as this worktree's.
        const againstMain = await diffCheckout(worktree.path, await mergeBaseWith(worktree.path, undefined));
        expect(againstMain.files?.map((file) => file.path)).toContain('feature.txt');

        const file = await diffFile(
            worktree.path,
            'feature.txt',
            { scope: 'base', staged: false, ignoreWhitespace: false },
            await mergeBaseWith(worktree.path, 'feature')
        );
        expect(file.diff).toBe('');
        // Nothing of the person's own index moved.
        expect(await gitIn(worktree.path, ['diff', '--cached', '--name-only'])).toBe('');
    });

    test('a branch that moved on since stays out of the diff and counts as behind', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await writeFile(join(worktree.path, 'lexer.txt'), 'lexer\n');
        await writeFile(join(repo, 'later.txt'), 'later\n');
        await gitIn(repo, ['add', '.']);
        await gitIn(repo, ['commit', '--quiet', '--message', 'later on feature']);

        const diff = await diffCheckout(worktree.path, await mergeBaseWith(worktree.path, 'feature'));
        expect(diff.files?.map((file) => file.path)).toEqual(['lexer.txt']);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed?.work).toEqual({ changed: 0, untracked: 1, ahead: 0, behind: 1 });
    });

    test('a named base that is gone falls back to the base branch of the repository', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        const main = (await gitIn(repo, ['merge-base', 'main', 'HEAD'])).trim();
        expect(await mergeBaseWith(worktree.path, 'no-such-branch')).toBe(main);
    });
});
