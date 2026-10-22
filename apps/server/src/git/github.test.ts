import { describe, expect, test } from 'bun:test';
import { ghError, jsonDocuments, parseIssueRef, readIssue, readPullRequest, runGh, type GhRunner } from './github.ts';

function fake(answers: Record<string, { code?: number; stdout?: string; stderr?: string }>): { run: GhRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: GhRunner = async (args) => {
        calls.push(args);
        const answer = answers[args.slice(0, 2).join(' ')];
        return { code: answer?.code ?? 0, stdout: answer?.stdout ?? '', stderr: answer?.stderr ?? '' };
    };
    return { run, calls };
}

const issue = {
    number: 12,
    title: 'It breaks',
    body: 'Steps',
    url: 'https://github.com/o/r/issues/12',
    state: 'OPEN',
    author: { login: 'ada' },
    labels: [{ name: 'bug' }]
};

describe('parseIssueRef', () => {
    test('reads a link, owner/repo#12 and #12', () => {
        expect(parseIssueRef('https://github.com/o/r/issues/12')).toEqual({ repo: 'o/r', number: 12 });
        expect(parseIssueRef('https://github.com/o/r/issues/12#issuecomment-5')).toEqual({ repo: 'o/r', number: 12 });
        expect(parseIssueRef(' o/r#12 ')).toEqual({ repo: 'o/r', number: 12 });
        expect(parseIssueRef('#12')).toEqual({ repo: null, number: 12 });
    });

    test('refuses everything else', () => {
        expect(parseIssueRef('12')).toBeNull();
        expect(parseIssueRef('https://example.com/o/r/issues/12')).toBeNull();
        expect(parseIssueRef('o/r#')).toBeNull();
    });
});

describe('ghError', () => {
    test('tells a missing gh, a missing login and a missing issue apart', () => {
        expect(ghError({ code: 128, stdout: '', stderr: 'gh could not be started' }).code).toBe('gh-missing');
        expect(ghError({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }).code).toBe('gh-unauthenticated');
        expect(ghError({ code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to an issue or pull request with the number of 9.' }).code).toBe(
            'issue-not-found'
        );
        expect(ghError({ code: 1, stdout: '', stderr: 'boom' }).code).toBe('gh-failed');
    });
});

describe('readIssue', () => {
    test('reads an issue of the repository the reference names', async () => {
        const { run, calls } = fake({ 'issue view': { stdout: JSON.stringify(issue) } });
        expect(await readIssue(run, '/p', { repo: 'x/y', number: 12 })).toEqual({
            repo: 'x/y',
            number: 12,
            title: 'It breaks',
            body: 'Steps',
            url: 'https://github.com/o/r/issues/12',
            state: 'OPEN',
            author: 'ada',
            labels: ['bug']
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('x/y');
    });

    test('o/r#12 and x/y#12 read different repositories', async () => {
        const { run, calls } = fake({ 'issue view': { stdout: JSON.stringify(issue) } });
        await readIssue(run, '/p', { repo: 'o/r', number: 12 });
        await readIssue(run, '/p', { repo: 'x/y', number: 12 });
        expect(calls.map((args) => args[args.indexOf('--repo') + 1])).toEqual(['o/r', 'x/y']);
    });

    test('#12 asks gh which repository the folder is in first', async () => {
        const { run, calls } = fake({ 'repo view': { stdout: JSON.stringify({ nameWithOwner: 'me/mine' }) }, 'issue view': { stdout: JSON.stringify(issue) } });
        const read = await readIssue(run, '/p', { repo: null, number: 12 });
        expect(read.repo).toBe('me/mine');
        expect(calls.map((args) => args[0])).toEqual(['repo', 'issue']);
        expect(calls[1]).toContain('me/mine');
    });

    test('a failed gh is the error of its kind', async () => {
        const { run } = fake({ 'issue view': { code: 1, stderr: 'Could not resolve to an issue' } });
        await expect(readIssue(run, '/p', { repo: 'o/r', number: 1 })).rejects.toMatchObject({ code: 'issue-not-found' });
    });
});

describe('jsonDocuments', () => {
    test('splits pages written back to back, strings and nesting included', () => {
        const pages = jsonDocuments('{"a":"}{"}\n{"b":[1,{"c":2}]}{"d":"\\"}"}');
        expect(pages).toEqual([{ a: '}{' }, { b: [1, { c: 2 }] }, { d: '"}' }]);
    });

    test('flattens a slurped array of pages', () => {
        expect(jsonDocuments('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
    });
});

function thread(index: number): unknown {
    return {
        id: `T${index}`,
        isResolved: index % 2 === 0,
        isOutdated: false,
        path: 'src/a.ts',
        line: index,
        comments: {
            totalCount: 1,
            nodes: [
                {
                    author: { login: index === 120 ? 'coderabbitai[bot]' : 'ada', __typename: index === 120 ? 'Bot' : 'User' },
                    body: `c${index}`,
                    url: 'u',
                    createdAt: 't'
                }
            ]
        }
    };
}

function threadsPage(from: number, to: number, hasNext: boolean): string {
    const nodes = Array.from({ length: to - from + 1 }, (_, i) => thread(from + i));
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage: hasNext, endCursor: 'x' } } } } } });
}

function summaryPage(oid: string, runs: unknown[], hasNext: boolean): string {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    number: 12,
                    url: 'https://github.com/o/r/pull/12',
                    title: 'T',
                    state: 'OPEN',
                    isDraft: false,
                    headRefOid: oid,
                    headRefName: 'feature',
                    baseRefName: 'main',
                    mergeable: 'MERGEABLE',
                    mergeStateStatus: 'CLEAN',
                    reviewDecision: null,
                    additions: 7,
                    deletions: 3,
                    changedFiles: 2,
                    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: runs, pageInfo: { hasNextPage: hasNext, endCursor: 'x' } } } } }] }
                }
            }
        }
    });
}

describe('readPullRequest', () => {
    test('keeps every page of the threads and of the checks', async () => {
        const run: GhRunner = async (args) => {
            if (args[0] === 'pr') {
                return { code: 0, stdout: JSON.stringify({ number: 12, url: 'https://github.com/o/r/pull/12' }), stderr: '' };
            }
            const query = args.find((arg) => arg.startsWith('query=')) ?? '';
            if (query.includes('reviewThreads')) {
                return { code: 0, stdout: `${threadsPage(1, 100, true)}${threadsPage(101, 150, false)}`, stderr: '' };
            }
            const run1 = { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' };
            const run2 = { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' };
            return { code: 0, stdout: `${summaryPage('abc', [run1], true)}${summaryPage('abc', [run2], false)}`, stderr: '' };
        };
        const pr = await readPullRequest(run, '/p');
        expect(pr?.headSha).toBe('abc');
        expect(pr?.threads).toHaveLength(150);
        expect(pr?.threads[149]).toMatchObject({ id: 'T150', line: 150, resolved: true });
        expect(pr?.threads[119]?.comments[0]).toMatchObject({ author: 'coderabbitai[bot]', bot: true });
        expect(pr?.checks.map((check) => `${check.name}:${check.state}`)).toEqual(['lint:success', 'test:pending']);
        expect(pr?.checkState).toBe('pending');
        expect(pr).toMatchObject({ added: 7, deleted: 3, changedFiles: 2 });
    });

    test('a branch without a pull request answers null', async () => {
        const run: GhRunner = async () => ({ code: 1, stdout: '', stderr: 'no pull requests found for branch "x"' });
        expect(await readPullRequest(run, '/p')).toBeNull();
    });
});

describe('runGh', () => {
    test('says the folder is missing instead of a gh that cannot start', async () => {
        await expect(runGh(['--version'], '/definitely/not/a/folder')).rejects.toMatchObject({ code: 'folder-missing' });
    });
});
