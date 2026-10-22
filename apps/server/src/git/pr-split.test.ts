import { describe, expect, test } from 'bun:test';
import type { GitPullRequest } from '@ruimte/contracts';
import type { GhRunner } from './github.ts';
import { MAX_SPLIT_FILES, PrSplits, readPrSplit } from './pr-split.ts';

type File = { path: string; additions: number; deletions: number };

function pr(patch: Partial<GitPullRequest> = {}): GitPullRequest {
    return {
        repo: 'o/r',
        number: 12,
        url: 'https://github.com/o/r/pull/12',
        title: 'T',
        state: 'OPEN',
        isDraft: false,
        headSha: 'abc',
        headBranch: 'feature',
        baseBranch: 'main',
        mergeable: 'MERGEABLE',
        mergeState: 'CLEAN',
        reviewDecision: null,
        checks: [],
        checkState: 'none',
        threads: [],
        added: 0,
        deleted: 0,
        changedFiles: 0,
        ...patch
    };
}

/* The pull request whose totals are those of these files. */
function prOf(files: readonly File[], patch: Partial<GitPullRequest> = {}): GitPullRequest {
    return pr({
        added: files.reduce((total, file) => total + file.additions, 0),
        deleted: files.reduce((total, file) => total + file.deletions, 0),
        changedFiles: files.length,
        ...patch
    });
}

function page(nodes: readonly File[], hasNextPage: boolean): string {
    return JSON.stringify({ data: { repository: { pullRequest: { files: { nodes, pageInfo: { hasNextPage, endCursor: 'x' } } } } } });
}

/* Answers the files query with these pages, written back to back the way `gh api --paginate` does. */
function answering(pages: ReadonlyArray<readonly File[]>): { run: GhRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: GhRunner = async (args) => {
        calls.push(args);
        return { code: 0, stdout: pages.map((nodes, i) => page(nodes, i < pages.length - 1)).join(''), stderr: '' };
    };
    return { run, calls };
}

const FILES: File[] = [
    { path: 'src/a.ts', additions: 10, deletions: 2 },
    { path: 'src/a.test.ts', additions: 30, deletions: 4 },
    { path: 'src/__mocks__/a.ts', additions: 3, deletions: 1 },
    { path: 'bun.lock', additions: 200, deletions: 180 }
];

describe('readPrSplit', () => {
    test('sums every page of the files into their kinds', async () => {
        const { run, calls } = answering([FILES.slice(0, 2), FILES.slice(2)]);
        expect(await readPrSplit(run, '/p', prOf(FILES))).toEqual({
            code: { added: 10, deleted: 2 },
            tests: { added: 30, deleted: 4 },
            mocks: { added: 3, deleted: 1 },
            generated: { added: 200, deleted: 180 }
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('--paginate');
        expect(calls[0]).toContain('number=12');
    });

    test('a list shorter than the pull request gives no split', async () => {
        const { run } = answering([FILES.slice(0, 3)]);
        expect(await readPrSplit(run, '/p', prOf(FILES))).toBeNull();
    });

    test('a list whose lines do not add up to the totals gives no split', async () => {
        const { run } = answering([FILES]);
        expect(await readPrSplit(run, '/p', prOf(FILES, { added: 1 }))).toBeNull();
    });

    test('a pull request past the bound, or without totals, asks GitHub nothing', async () => {
        const { run, calls } = answering([FILES]);
        expect(await readPrSplit(run, '/p', prOf(FILES, { changedFiles: MAX_SPLIT_FILES + 1 }))).toBeNull();
        expect(await readPrSplit(run, '/p', pr({ added: undefined, deleted: undefined, changedFiles: undefined }))).toBeNull();
        expect(calls).toEqual([]);
    });
});

describe('PrSplits', () => {
    test('asks once for a head that did not move, and again for a new one', async () => {
        const { run, calls } = answering([FILES]);
        const splits = new PrSplits(run);
        const first = await splits.of('/p', prOf(FILES));
        expect(first?.generated).toEqual({ added: 200, deleted: 180 });
        await splits.of('/p', prOf(FILES));
        expect(calls).toHaveLength(1);
        await splits.of('/p', prOf(FILES, { headSha: 'def' }));
        expect(calls).toHaveLength(2);
    });

    test('a read that failed leaves the pull request without a split, and the next ask tries again', async () => {
        let fail = true;
        let asked = 0;
        const run: GhRunner = async () => {
            asked += 1;
            return fail ? { code: 1, stdout: '', stderr: 'HTTP 502' } : { code: 0, stdout: page(FILES, false), stderr: '' };
        };
        const splits = new PrSplits(run);
        expect(await splits.of('/p', prOf(FILES))).toBeNull();
        fail = false;
        expect(await splits.of('/p', prOf(FILES))).not.toBeNull();
        expect(asked).toBe(2);
    });

    test('starts reading the split of a pull request it was answered, and gives it at that head without reading the pull request again', async () => {
        const { run, calls } = answering([FILES]);
        const splits = new PrSplits(run);
        const reads: number[] = [];
        const read = async (): Promise<GitPullRequest | null> => {
            reads.push(1);
            return prOf(FILES, { headSha: 'def' });
        };
        splits.note('/p', prOf(FILES));
        expect(calls).toHaveLength(1);
        expect((await splits.splitAt('/p', 12, 'abc', read))?.code).toEqual({ added: 10, deleted: 2 });
        expect(calls).toHaveLength(1);
        expect(reads).toEqual([]);
    });

    test('reads the pull request again for a head it was not answered at, and gives no split once it moved', async () => {
        const { run } = answering([FILES]);
        const splits = new PrSplits(run);
        splits.note('/p', prOf(FILES));
        expect(await splits.splitAt('/p', 12, 'old', async () => prOf(FILES))).toBeNull();
        expect(await splits.splitAt('/p', 13, 'abc', async () => prOf(FILES, { number: 13 }))).not.toBeNull();
        expect(await splits.splitAt('/p', 14, 'abc', async () => null)).toBeNull();
    });
});
