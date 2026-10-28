import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffCommit } from './diff.ts';
import { parseLog, readCommit, readLog } from './log.ts';
import { nativePath } from './native-path.ts';
import { parseRefs, parseWorktreeBranches } from './refs.ts';
import { FIELD } from './run.ts';
import { gitIn } from './test-repo.ts';

let root: string;
let repo: string;

function run(args: string[], cwd: string = repo): Promise<string> {
    return gitIn(cwd, args);
}

// Built once for the file: every test here only reads the history, and each commit is two processes.
beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-log-')));
    repo = join(root, 'repo');
    await mkdir(repo);
    await run(['init', '--quiet', '--initial-branch=main']);
    for (let i = 1; i <= 5; i += 1) {
        await writeFile(join(repo, `file-${i}.txt`), `body ${i}\n`);
        await run(['add', '.']);
        await run(['commit', '--quiet', '--message', `commit ${i}`]);
    }
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the log', () => {
    test('a page carries the newest commits and a cursor to the rest', async () => {
        const first = await readLog(repo, 2);
        expect(first.commits.map((commit) => commit.subject)).toEqual(['commit 5', 'commit 4']);
        expect(first.commits[0]?.author).toBe('Ada');
        expect(first.commits[0]?.refs).toContain('main');
        expect(first.cursor).not.toBeNull();

        const second = await readLog(repo, 2, first.cursor ?? undefined);
        expect(second.commits.map((commit) => commit.subject)).toEqual(['commit 3', 'commit 2']);

        const last = await readLog(repo, 2, second.cursor ?? undefined);
        expect(last.commits.map((commit) => commit.subject)).toEqual(['commit 1']);
        expect(last.cursor).toBeNull();
    });

    test('a repository without a commit has an empty log', async () => {
        const empty = join(root, 'empty');
        await mkdir(empty);
        await run(['init', '--quiet', '--initial-branch=main'], empty);
        expect(await readLog(empty, 10)).toEqual({ commits: [], cursor: null });
    });

    test('a subject with the field separator in it stays one subject', () => {
        const record = [
            'abc',
            'abc123',
            'Ada',
            '1700000000',
            '1700000500',
            'ada@example.com',
            'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/heads/fix/a, tag: refs/tags/v1',
            `fix: a${FIELD}b`
        ].join(FIELD);
        const [commit] = parseLog(`${record}\0`);
        expect(commit?.subject).toBe(`fix: a${FIELD}b`);
        expect(commit?.refs).toEqual(['main', 'origin/main', 'fix/a', 'v1']);
        expect(commit?.remoteRefs).toEqual(['origin/main']);
        expect(commit?.at).toBe(1700000000);
        expect(commit?.committedAt).toBe(1700000500);
        expect(commit?.authorEmail).toBe('ada@example.com');
    });

    test('a commit carries the date it was committed beside the one it was written', async () => {
        const dated = join(root, 'dated');
        await mkdir(dated);
        await run(['init', '--quiet', '--initial-branch=main'], dated);
        await run(['commit', '--quiet', '--allow-empty', '--message', 'old work', '--date=@1700000000'], dated);
        const [commit] = (await readLog(dated, 1)).commits;
        expect(commit?.at).toBe(1700000000);
        expect(commit?.committedAt).toBeGreaterThan(1700000000);
    });
});

describe('a commit as a diff', () => {
    test('the whole commit answers its files, its counts and the row that names it', async () => {
        const head = (await run(['rev-parse', 'HEAD'])).trim();
        const diff = await diffCommit(repo, head);

        expect(diff.commit?.subject).toBe('commit 5');
        expect(diff.files?.map((file) => file.path)).toEqual(['file-5.txt']);
        expect(diff.added).toBe(1);
        expect(diff.files?.[0]?.diff).toContain('+body 5');
        expect(diff.files?.[0]?.kind).toBe('add');
    });

    test('the first commit is read against the empty tree', async () => {
        const first = (await run(['rev-list', '--max-parents=0', 'HEAD'])).trim();
        const diff = await diffCommit(repo, first);
        expect(diff.files?.map((file) => file.path)).toEqual(['file-1.txt']);
        expect(await readCommit(repo, first)).not.toBeNull();
    });

    test('a file larger than a turn would store still shows its diff', async () => {
        await run(['checkout', '--quiet', '-b', 'large']);
        await writeFile(join(repo, 'large.md'), `${'a long line of prose in a readme '.repeat(40)}\n`.repeat(200));
        await run(['add', '.']);
        await run(['commit', '--quiet', '--message', 'large']);
        const head = (await run(['rev-parse', 'HEAD'])).trim();
        await run(['checkout', '--quiet', 'main']);

        const [file] = (await diffCommit(repo, head)).files ?? [];
        expect(file?.omitted).toBeUndefined();
        expect(file?.diff.length).toBeGreaterThan(128 * 1024);
    });
});

describe('refs', () => {
    test('a worktree paragraph names the branch it has out', () => {
        const output = 'worktree /a/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /a/side\nHEAD def\nbranch refs/heads/side\n';
        expect(parseWorktreeBranches(output)).toEqual(
            new Map([
                ['main', nativePath('/a/main')],
                ['side', nativePath('/a/side')]
            ])
        );
    });

    test('the symbolic pointer at the remote head is not a branch to check out', () => {
        const lines = [`origin/HEAD${FIELD}1700000000`, `origin/main${FIELD}1700000000`].join('\n');
        const refs = parseRefs(lines, 'remote', new Map(), 'origin/main');
        expect(refs.map((ref) => ref.name)).toEqual(['origin/main']);
        expect(refs[0]?.isDefault).toBe(true);
    });
});
