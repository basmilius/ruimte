import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffCommit, diffFile } from './diff.ts';
import { forgetBase, mergeBaseOf, readStatus } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

let template: RepoTemplate;
let root: string;
let repo: string;

function git(args: string[], cwd: string = repo): Promise<string> {
    return gitIn(cwd, args);
}

function write(name: string, body: string): Promise<void> {
    return writeFile(join(repo, name), body);
}

beforeAll(async () => {
    template = await repoTemplate('ruimte-status', (dir) => initRepo(join(dir, 'repo'), { 'tracked.txt': 'one\ntwo\nthree\n' }));
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    repo = join(root, 'repo');
    forgetBase();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('readStatus', () => {
    test('reading leaves the index alone, so a commit beside it never meets its lock', async () => {
        await write('tracked.txt', 'one\ntwo\nthree\nfour\n');
        const touched = new Date((await stat(join(repo, 'tracked.txt'))).mtimeMs + 2_000);
        await utimes(join(repo, 'tracked.txt'), touched, touched);
        const before = await stat(join(repo, '.git', 'index'));
        await readStatus(repo);
        const after = await stat(join(repo, '.git', 'index'));
        expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    test('a folder outside a repository answers that it is not one', async () => {
        expect(await readStatus(root)).toMatchObject({ repo: false, root: null, branch: null, files: [] });
    });

    test('groups the files by state and counts what each side changed', async () => {
        await write('tracked.txt', 'one\ntwo\nthree\nfour\n');
        await git(['add', 'tracked.txt']);
        await write('tracked.txt', 'one\ntwo\nthree\nfour\nfive\n');
        await write('fresh.txt', 'a\nb\n');

        const status = await readStatus(repo);
        expect(status).toMatchObject({ repo: true, root: repo, branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, truncated: false });
        expect(status.files).toEqual([
            { path: 'tracked.txt', state: 'staged', status: 'M', added: 1, deleted: 0, binary: false },
            { path: 'tracked.txt', state: 'unstaged', status: 'M', added: 1, deleted: 0, binary: false },
            { path: 'fresh.txt', state: 'untracked', status: '?', added: 2, deleted: 0, binary: false }
        ]);
    });

    test('an untracked file named like an option is counted and never read as one', async () => {
        await write('victim.txt', 'keep me\n');
        await git(['add', 'victim.txt']);
        await write('--output=victim.txt', 'a\n');

        const status = await readStatus(repo);
        expect(await readFile(join(repo, 'victim.txt'), 'utf8')).toBe('keep me\n');
        expect(status.files).toContainEqual({ path: '--output=victim.txt', state: 'untracked', status: '?', added: 1, deleted: 0, binary: false });
    });

    test('the base is the branch the work is measured against, and the merge base is where it left', async () => {
        await git(['checkout', '-q', '-b', 'feature']);
        await write('tracked.txt', 'one\ntwo\nthree\nfour\n');
        await git(['commit', '-q', '-am', 'more']);

        const status = await readStatus(repo);
        expect(status.branch).toBe('feature');
        expect(status.base).toBe('main');
        const main = await git(['rev-parse', 'main']);
        expect(status.mergeBase).toBe(main.trim());
        expect(await mergeBaseOf(repo)).toBe(main.trim());
    });
});

describe('diffFile', () => {
    test('an untracked file named like an option diffs as a file', async () => {
        await write('victim.txt', 'keep me\n');
        await write('--output=victim.txt', 'a\n');
        const diff = await diffFile(repo, '--output=victim.txt', { scope: 'worktree', staged: false, ignoreWhitespace: false }, null);
        expect(diff).toMatchObject({ added: 1, deleted: 0 });
        expect(await readFile(join(repo, 'victim.txt'), 'utf8')).toBe('keep me\n');
    });

    test('a commit named like an option is never read as one', async () => {
        await write('victim.txt', 'keep me\n');
        const options = { scope: 'commit' as const, commit: '--output=victim.txt', staged: false, ignoreWhitespace: false };
        await diffFile(repo, 'tracked.txt', options, null).catch(() => undefined);
        await diffCommit(repo, '--output=victim.txt').catch(() => undefined);
        expect(await readFile(join(repo, 'victim.txt'), 'utf8')).toBe('keep me\n');
    });

    test('whitespace-only changes are gone when the diff is asked to ignore them', async () => {
        await write('tracked.txt', 'one  \ntwo\nthree\n');
        expect((await diffFile(repo, 'tracked.txt', { scope: 'worktree', staged: false, ignoreWhitespace: false }, null)).added).toBe(1);
        const ignored = await diffFile(repo, 'tracked.txt', { scope: 'worktree', staged: false, ignoreWhitespace: true }, null);
        expect(ignored).toMatchObject({ added: 0, deleted: 0 });
        expect(ignored.diff).toBe('');
    });
});
