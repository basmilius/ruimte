import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffCommit } from './diff.ts';
import { LOG_FORMAT, parseLog, readCommit, readLog } from './log.ts';
import { parseRefs, parseWorktreeBranches } from './refs.ts';

// The separator both formats put between their fields, which no branch or subject can hold.
const FIELD = '\u001f';

let root: string;
let repo: string;

const run = async (args: string[], cwd: string = repo): Promise<string> => {
    const proc = Bun.spawn(['git', ...args], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'a@a' }
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) {
        throw new Error(await new Response(proc.stderr).text());
    }
    return stdout;
};

beforeEach(async () => {
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

afterEach(async () => {
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
        const record = ['abc', 'abc123', 'Ada', '1700000000', 'HEAD -> main, tag: v1', `fix: a${FIELD}b`].join(FIELD);
        const [commit] = parseLog(`${record}\0`);
        expect(commit?.subject).toBe(`fix: a${FIELD}b`);
        expect(commit?.refs).toEqual(['main', 'v1']);
        expect(LOG_FORMAT.split(FIELD)).toHaveLength(6);
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
    });

    test('the first commit is read against the empty tree', async () => {
        const first = (await run(['rev-list', '--max-parents=0', 'HEAD'])).trim();
        const diff = await diffCommit(repo, first);
        expect(diff.files?.map((file) => file.path)).toEqual(['file-1.txt']);
        expect(await readCommit(repo, first)).not.toBeNull();
    });
});

describe('refs', () => {
    test('a worktree paragraph names the branch it has out', () => {
        const output = 'worktree /a/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /a/side\nHEAD def\nbranch refs/heads/side\n';
        expect(parseWorktreeBranches(output)).toEqual(
            new Map([
                ['main', '/a/main'],
                ['side', '/a/side']
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
