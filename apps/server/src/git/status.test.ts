import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffFile } from './diff.ts';
import { forgetBase, mergeBaseOf, parsePorcelain, readStatus } from './status.ts';

let root: string;
let repo: string;

const git = async (args: string[], cwd: string = repo): Promise<void> => {
    const proc = Bun.spawn(['git', ...args], {
        cwd,
        stdout: 'ignore',
        stderr: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    });
    if ((await proc.exited) !== 0) {
        throw new Error(await new Response(proc.stderr).text());
    }
};

const write = (name: string, body: string): Promise<void> => writeFile(join(repo, name), body);

beforeEach(async () => {
    // Git reports real paths, and the temp dir sits behind a symlink on macOS (/var to /private/var).
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-status-')));
    repo = join(root, 'repo');
    await mkdir(repo);
    await git(['init', '-q', '-b', 'main']);
    await write('tracked.txt', 'one\ntwo\nthree\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
    forgetBase();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('parsePorcelain', () => {
    test('reads the branch, the upstream and both counts out of the header', () => {
        const output = ['# branch.oid abc', '# branch.head feature/x', '# branch.upstream origin/feature/x', '# branch.ab +2 -3'].join('\0') + '\0';
        expect(parsePorcelain(output)).toMatchObject({ branch: 'feature/x', detached: false, upstream: 'origin/feature/x', ahead: 2, behind: 3 });
    });

    test('a detached HEAD has no branch of its own', () => {
        expect(parsePorcelain('# branch.head (detached)\0')).toMatchObject({ branch: null, detached: true });
    });

    test('a rename carries the path it came from, which is the record right after it', () => {
        const output = ['2 R. N... 100644 100644 100644 abc def R100 new.txt', 'old.txt', '1 .M N... 100644 100644 100644 abc def other.txt'].join('\0') + '\0';
        const parsed = parsePorcelain(output);
        expect(parsed.entries).toEqual([
            { path: 'new.txt', oldPath: 'old.txt', index: 'R', worktree: '.', unmerged: false, untracked: false },
            { path: 'other.txt', index: '.', worktree: 'M', unmerged: false, untracked: false }
        ]);
    });

    test('an unmerged file and an untracked one are told apart from an ordinary change', () => {
        const output = ['u UU N... 100644 100644 100644 100644 a b c both.txt', '? new.txt'].join('\0') + '\0';
        expect(parsePorcelain(output).entries).toEqual([
            { path: 'both.txt', index: 'U', worktree: 'U', unmerged: true, untracked: false },
            { path: 'new.txt', index: '?', worktree: '?', unmerged: false, untracked: true }
        ]);
    });
});

describe('readStatus', () => {
    test('a folder outside a repository answers that it is not one', async () => {
        expect(await readStatus(root)).toMatchObject({ repo: false, root: null, files: [] });
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

    test('the base is the branch the work is measured against, and the merge base is where it left', async () => {
        await git(['checkout', '-q', '-b', 'feature']);
        await write('tracked.txt', 'one\ntwo\nthree\nfour\n');
        await git(['commit', '-q', '-am', 'more']);

        const status = await readStatus(repo);
        expect(status.branch).toBe('feature');
        expect(status.base).toBe('main');
        const main = await Bun.$`git rev-parse main`.cwd(repo).text();
        expect(status.mergeBase).toBe(main.trim());
        expect(await mergeBaseOf(repo)).toBe(main.trim());
    });
});

describe('diffFile', () => {
    test('an untracked file diffs against nothing, so the whole file is added', async () => {
        await write('fresh.txt', 'a\nb\n');
        const diff = await diffFile(repo, 'fresh.txt', 'worktree', false, null);
        expect(diff).toMatchObject({ path: 'fresh.txt', added: 2, deleted: 0, binary: false });
        expect(diff.diff).toContain('+a');
        expect(diff.diff).toContain('+b');
    });

    test('the staged and the unstaged half of a file are two diffs', async () => {
        await write('tracked.txt', 'one\ntwo\nthree\nfour\n');
        await git(['add', 'tracked.txt']);
        await write('tracked.txt', 'one\ntwo\nthree\nfour\nfive\n');

        expect((await diffFile(repo, 'tracked.txt', 'worktree', true, null)).diff).toContain('+four');
        const unstaged = await diffFile(repo, 'tracked.txt', 'worktree', false, null);
        expect(unstaged.diff).toContain('+five');
        expect(unstaged.diff).not.toContain('+four');
    });

    test('the base scope holds what the branch committed and what it has not committed yet', async () => {
        await git(['checkout', '-q', '-b', 'feature']);
        await write('tracked.txt', 'one\ntwo\nthree\nfour\n');
        await git(['commit', '-q', '-am', 'more']);
        await write('tracked.txt', 'one\ntwo\nthree\nfour\nfive\n');

        const diff = await diffFile(repo, 'tracked.txt', 'base', false, await mergeBaseOf(repo));
        expect(diff.diff).toContain('+four');
        expect(diff.diff).toContain('+five');
        expect(diff.added).toBe(2);
    });
});
