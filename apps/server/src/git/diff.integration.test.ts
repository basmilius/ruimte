import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffFile, type DiffOptions } from './diff.ts';
import { mergeBaseOf } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

const ORIGINAL = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';

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
        expect(diff.diff).toContain('+TWO');
        expect(diff.diff).not.toContain('+eleven');
        const unstaged = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(unstaged).toMatchObject({ oldText: staged, newText: `${staged}eleven\n` });
        expect(unstaged.diff).toContain('+eleven');
        expect(unstaged.diff).not.toContain('+TWO');
    });

    test('an untracked file has nothing on its old side', async () => {
        await write('fresh.txt', 'a\nb\n');
        const diff = await diffFile(repo, 'fresh.txt', worktree(), null);
        expect(diff).toMatchObject({ path: 'fresh.txt', oldText: '', newText: 'a\nb\n', added: 2, deleted: 0, binary: false });
        expect(diff.diff).toContain('+a');
        expect(diff.diff).toContain('+b');
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
        expect(diff.added).toBe(2);
        expect(diff.diff).toContain('+TWO');
        expect(diff.diff).toContain('+eleven');
    });

    test('ignoring whitespace keeps the texts as they are', async () => {
        const changed = ORIGINAL.replace('two', '  two').replace('nine', 'NINE');
        await write('tracked.txt', changed);
        const diff = await diffFile(repo, 'tracked.txt', worktree(false, true), null);
        expect(diff.added).toBe(1);
        expect(diff.newText).toBe(changed);
    });

    test('a header-like line removed from the file does not mark a side as missing', async () => {
        await write('tracked.txt', '-- /dev/null\n');
        await gitIn(repo, ['add', 'tracked.txt']);
        await write('tracked.txt', 'changed\n');
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff).toMatchObject({ oldText: '-- /dev/null\n', newText: 'changed\n' });
    });

    test('snapshots preserve CRLF contents and a UTF-8 byte order mark', async () => {
        // Keep the fixture's blob bytes independent of the runner's newline conversion.
        await gitIn(repo, ['config', '--local', 'core.autocrlf', 'false']);
        const original = '\uFEFFone\r\ntwo\r\nthree\r\n';
        const changed = original.replace('two', 'TWO');
        await write('tracked.txt', original);
        await gitIn(repo, ['add', 'tracked.txt']);
        await write('tracked.txt', changed);
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff).toMatchObject({ oldText: original, newText: changed });
    });

    test('a patch normalized by Git is kept without incompatible raw snapshots', async () => {
        await gitIn(repo, ['config', '--local', 'core.autocrlf', 'input']);
        await write('tracked.txt', 'one\r\ntwo\r\nthree\r\n');
        await gitIn(repo, ['add', 'tracked.txt']);
        await write('tracked.txt', 'one\r\nTWO\r\nthree\r\n');
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff.diff).toContain('+TWO');
        expect(diff.oldText).toBeUndefined();
        expect(diff.newText).toBeUndefined();
    });

    test('snapshots preserve missing final newlines on both sides', async () => {
        await write('tracked.txt', 'old');
        await gitIn(repo, ['add', 'tracked.txt']);
        await write('tracked.txt', 'new');
        const diff = await diffFile(repo, 'tracked.txt', worktree(), null);
        expect(diff).toMatchObject({ oldText: 'old', newText: 'new' });
        expect(diff.diff).toContain('\\ No newline at end of file');
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

    test('a path that climbs out of the checkout is refused', async () => {
        await writeFile(join(root, 'outside.txt'), 'secret\n');
        for (const path of ['../outside.txt', join(root, 'outside.txt'), 'missing/../../outside.txt']) {
            await expect(diffFile(repo, path, worktree(), null)).rejects.toMatchObject({ code: 'outside-checkout' });
        }
    });

    test('a path through a symlinked folder out of the checkout is refused', async () => {
        await writeFile(join(root, 'outside.txt'), 'secret\n');
        await symlink(root, join(repo, 'up'));
        await expect(diffFile(repo, 'up/outside.txt', worktree(), null)).rejects.toMatchObject({ code: 'outside-checkout' });
    });

    test('a symlink out of the repository is never read', async () => {
        await writeFile(join(root, 'outside.txt'), 'secret\n');
        await symlink(join(root, 'outside.txt'), join(repo, 'link.txt'));
        const diff = await diffFile(repo, 'link.txt', worktree(), null);
        expect(diff.newText).toBeUndefined();
    });
});
