import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffFile, missingSides, patchFits, type DiffOptions } from './diff.ts';
import { mergeBaseOf } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

const ORIGINAL = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';

const PATCH = ['diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -2,3 +2,3 @@', ' two', '-three', '+THREE', ' four', ''].join('\n');

describe('missingSides', () => {
    test('a new file is missing on the old side and a deleted one on the new side', () => {
        expect(missingSides('--- /dev/null\n+++ b/x.txt\n@@ -0,0 +1 @@\n+a\n')).toEqual({ old: true, new: false });
        expect(missingSides('--- a/x.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n')).toEqual({ old: false, new: true });
    });

    test('a removed line that reads like a header is not one', () => {
        expect(missingSides('--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n--- /dev/null\n+b\n')).toEqual({ old: false, new: false });
    });
});

describe('patchFits', () => {
    test('a patch fits the two texts it was made from', () => {
        expect(patchFits(PATCH, ORIGINAL, ORIGINAL.replace('three', 'THREE'), false)).toBe(true);
    });

    test('a text that moved since the patch does not fit', () => {
        expect(patchFits(PATCH, ORIGINAL, `zero\n${ORIGINAL.replace('three', 'THREE')}`, false)).toBe(false);
    });

    test('a patch without hunks fits nothing', () => {
        expect(patchFits('diff --git a/x b/x\nold mode 100644\nnew mode 100755\n', 'a\n', 'a\n', false)).toBe(false);
    });

    test('a shared line that differs only in spacing fits when whitespace is ignored', () => {
        const patch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', ''].join('\n');
        expect(patchFits(patch, 'one\ntwo\n', '  one\nTWO\n', false)).toBe(false);
        expect(patchFits(patch, 'one\ntwo\n', '  one\nTWO\n', true)).toBe(true);
    });

    test('a file without a final newline fits', () => {
        const patch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file', ''].join('\n');
        expect(patchFits(patch, 'a', 'b', false)).toBe(true);
    });
});

describe('diffFile with the whole texts', () => {
    let template: RepoTemplate;
    let root: string;
    let repo: string;

    const write = (name: string, body: string): Promise<void> => writeFile(join(repo, name), body);
    const worktree = (staged = false, ignoreWhitespace = false): DiffOptions => ({ scope: 'worktree', staged, ignoreWhitespace });

    beforeAll(async () => {
        template = await repoTemplate('ruimte-diff', (dir) => initRepo(join(dir, 'repo'), { 'tracked.txt': ORIGINAL }));
    });

    afterAll(async () => {
        await template.dispose();
    });

    beforeEach(async () => {
        root = await template.copy();
        repo = join(root, 'repo');
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('the unstaged half reads the index against the working tree', async () => {
        const changed = ORIGINAL.replace('two', 'TWO').replace('nine', 'NINE');
        await write('tracked.txt', changed);
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff.oldText).toBe(ORIGINAL);
        expect(diff.newText).toBe(changed);
    });

    test('the staged half reads HEAD against the index, whatever the working tree holds since', async () => {
        const staged = ORIGINAL.replace('two', 'TWO');
        await write('tracked.txt', staged);
        await gitIn(repo, ['add', 'tracked.txt']);
        await write('tracked.txt', `${staged}eleven\n`);
        const diff = await diffFile(repo, 'tracked.txt', worktree(true), null);
        expect(diff.oldText).toBe(ORIGINAL);
        expect(diff.newText).toBe(staged);
    });

    test('an untracked file has nothing on its old side', async () => {
        await write('fresh.txt', 'a\nb\n');
        const diff = await diffFile(repo, 'fresh.txt', worktree(), null);
        expect(diff).toMatchObject({ oldText: '', newText: 'a\nb\n' });
    });

    test('a deleted file has nothing on its new side', async () => {
        await unlink(join(repo, 'tracked.txt'));
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff).toMatchObject({ oldText: ORIGINAL, newText: '' });
    });

    test('the base scope reads the merge base against the working tree', async () => {
        await gitIn(repo, ['checkout', '-q', '-b', 'feature']);
        const committed = ORIGINAL.replace('two', 'TWO');
        await write('tracked.txt', committed);
        await gitIn(repo, ['commit', '-q', '-am', 'more']);
        await write('tracked.txt', `${committed}eleven\n`);
        const diff = await diffFile(repo, 'tracked.txt', { scope: 'base', staged: false, ignoreWhitespace: false }, await mergeBaseOf(repo));
        expect(diff.oldText).toBe(ORIGINAL);
        expect(diff.newText).toBe(`${committed}eleven\n`);
    });

    test('ignoring whitespace keeps the texts as they are', async () => {
        const changed = ORIGINAL.replace('two', '  two').replace('nine', 'NINE');
        await write('tracked.txt', changed);
        const diff = await diffFile(repo, 'tracked.txt', worktree(false, true), null);
        expect(diff.added).toBe(1);
        expect(diff.newText).toBe(changed);
    });

    test('a file without a change carries no texts', async () => {
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff.diff).toBe('');
        expect(diff.oldText).toBeUndefined();
    });

    test('a side over the cap leaves both texts out and keeps the patch', async () => {
        const large = 'x'.repeat(1024).concat('\n').repeat(600);
        await write('large.txt', large);
        await gitIn(repo, ['add', 'large.txt']);
        await gitIn(repo, ['commit', '-q', '-m', 'large']);
        await write('large.txt', `changed\n${large}`);
        const diff = await diffFile(repo, 'large.txt', worktree(), null);
        expect(diff.diff).toContain('+changed');
        expect(diff.oldText).toBeUndefined();
        expect(diff.newText).toBeUndefined();
    });

    test('a symlink out of the repository is never read', async () => {
        await writeFile(join(root, 'outside.txt'), 'secret\n');
        await symlink(join(root, 'outside.txt'), join(repo, 'link.txt'));
        const diff = await diffFile(repo, 'link.txt', worktree(), null);
        expect(diff.newText).toBeUndefined();
    });
});
