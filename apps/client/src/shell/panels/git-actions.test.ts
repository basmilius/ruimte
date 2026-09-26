import { describe, expect, test } from 'bun:test';
import type { GitCommit, GitFile, GitStatus } from '@ruimte/contracts';
import { groupCommits, mergeLogs, relativeTime, type LoadedLog } from './commit-log';
import { actionTitle, commitTargets, isUnmergedRefusal, manySummary, phaseLabel, pushable, pushButton, pushEntries, splitMessage } from './git-actions';

const status = (patch: Partial<GitStatus> = {}): GitStatus => ({
    repo: true,
    root: '/repo',
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    base: 'origin/main',
    mergeBase: null,
    files: [],
    truncated: false,
    live: true,
    ...patch
});

const checkout = (label: string, patch: Partial<GitStatus> | null): { path: string; label: string; status: GitStatus | null } => ({
    path: `/work/${label}`,
    label,
    status: patch === null ? null : status(patch)
});

const commit = (at: number, hash: string): GitCommit => ({ hash, shortHash: hash.slice(0, 7), subject: hash, author: 'Ada', at, refs: [] });

const row = (at: number, hash: string) => ({ ...commit(at, hash), cwd: '/work/one', repo: '' });

const log = (repo: string, ats: number[], cursor: string | null): LoadedLog => ({
    cwd: `/work/${repo}`,
    repo,
    commits: ats.map((at) => commit(at, `${repo}-${at}`)),
    cursor
});

describe('pushing a folder of repositories', () => {
    test('every repository says for itself what a push would do', () => {
        const entries = pushEntries([checkout('one', { ahead: 2 }), checkout('two', { upstream: null }), checkout('three', {})]);
        expect(entries.map((entry) => [entry.label, entry.button.kind, entry.button.disabled, entry.ahead])).toEqual([
            ['one', 'push', false, 2],
            ['two', 'publish', false, 0],
            ['three', 'push', true, 0]
        ]);
    });

    test('a repository whose status is not in yet is nothing to push', () => {
        expect(pushable(pushEntries([checkout('one', null)]))).toEqual([]);
    });

    test('"push all" runs only the ones that would move', () => {
        const entries = pushEntries([checkout('one', { ahead: 1 }), checkout('two', {}), checkout('three', { ahead: 4 })]);
        expect(pushable(entries).map((entry) => entry.label)).toEqual(['one', 'three']);
    });

    test('the summary counts what went well, and names what did not', () => {
        expect(manySummary(1, [])).toBe('Done in 1 repository');
        expect(manySummary(3, [])).toBe('Done in 3 repositories');
        expect(manySummary(1, ['two'])).toBe('1 repository failed: two');
        expect(manySummary(0, ['two', 'three'])).toBe('2 repositories failed: two, three');
    });
});

describe('where a commit lands', () => {
    const repo = (label: string, states: GitFile['state'][]) => ({
        path: `/work/${label}`,
        label,
        status: status({ files: states.map((state, index) => ({ path: `${index}.ts`, state, status: 'M', added: 1, deleted: 0, binary: false })) })
    });

    test('every repository with something staged takes the commit', () => {
        const { targets, stageAll } = commitTargets([repo('one', ['staged']), repo('two', ['unstaged']), repo('three', ['staged', 'unstaged'])]);
        expect(targets.map((target) => target.label)).toEqual(['one', 'three']);
        expect(stageAll).toBe(false);
    });

    test('a single repository with nothing staged is the commit that stages first', () => {
        const { targets, stageAll } = commitTargets([repo('one', ['unstaged'])]);
        expect(targets.map((target) => target.label)).toEqual(['one']);
        expect(stageAll).toBe(true);
    });

    test('two repositories with nothing staged have no commit to make yet', () => {
        expect(commitTargets([repo('one', ['unstaged']), repo('two', ['untracked'])]).targets).toEqual([]);
    });

    test('a folder with nothing changed anywhere has none either', () => {
        expect(commitTargets([repo('one', [])]).targets).toEqual([]);
        expect(commitTargets([{ path: '/work/one', label: 'one', status: null }]).targets).toEqual([]);
    });
});

describe('the push button', () => {
    test('a branch without an upstream is published', () => {
        const button = pushButton(status({ upstream: null }));
        expect(button.label).toBe('Publish branch');
        expect(button.kind).toBe('publish');
        expect(button.disabled).toBe(false);
    });

    test('nothing ahead is nothing to push', () => {
        const button = pushButton(status());
        expect(button.disabled).toBe(true);
        expect(button.reason).toBe('Nothing to push');
    });

    test('commits ahead push, and the reason counts them', () => {
        expect(pushButton(status({ ahead: 1 })).reason).toBe('Push 1 commit to origin/main');
        expect(pushButton(status({ ahead: 3 })).reason).toBe('Push 3 commits to origin/main');
        expect(pushButton(status({ ahead: 3 })).disabled).toBe(false);
    });

    test('a detached head and a folder without a repository have nothing to push', () => {
        expect(pushButton(status({ detached: true, branch: null, ahead: 2 })).disabled).toBe(true);
        expect(pushButton(status({ repo: false })).disabled).toBe(true);
        expect(pushButton(null).disabled).toBe(true);
    });
});

describe('what a toast says', () => {
    test('every phase and every kind has words of its own', () => {
        expect(phaseLabel('push')).toBe('Pushing');
        expect(phaseLabel('failed')).toBe('That did not work');
        expect(actionTitle('commit-push')).toBe('Committing and pushing');
    });

    test('only an unmerged branch earns a second ask', () => {
        expect(isUnmergedRefusal("error: the branch 'work' is not fully merged")).toBe(true);
        expect(isUnmergedRefusal('error: branch not found')).toBe(false);
    });
});

describe('the commit message', () => {
    test('the first line is the subject and the rest is the body', () => {
        expect(splitMessage('feat: a thing\n\nBecause of this.\nAnd that.')).toEqual({ subject: 'feat: a thing', body: 'Because of this.\nAnd that.' });
        expect(splitMessage('  fix: trim me  ')).toEqual({ subject: 'fix: trim me', body: '' });
        expect(splitMessage('')).toEqual({ subject: '', body: '' });
    });
});

describe('the log', () => {
    const now = Math.floor(new Date('2026-09-10T12:00:00Z').getTime() / 1000);

    test('a commit is dated in the words its age asks for', () => {
        expect(relativeTime(now - 10, now)).toBe('now');
        expect(relativeTime(now - 5 * 60, now)).toBe('5m ago');
        expect(relativeTime(now - 3 * 3600, now)).toBe('3h ago');
        expect(relativeTime(now - 3 * 86400, now)).toBe('3d ago');
        expect(relativeTime(now - 40 * 86400, now)).toMatch(/^[A-Z][a-z]{2} \d+$/);
    });

    test('commits fall under the day they were written on, in the order they came in', () => {
        const midnight = Math.floor(new Date('2026-09-10T00:00:00').getTime() / 1000);
        const sections = groupCommits([row(midnight + 3600, 'a'), row(midnight - 3600, 'b'), row(midnight - 5 * 86400, 'c')], now);

        expect(sections.map((section) => section.label)).toEqual(['Today', 'Yesterday', expect.any(String)]);
        expect(sections[0]?.commits.map((entry) => entry.hash)).toEqual(['a']);
        expect(sections[1]?.commits.map((entry) => entry.hash)).toEqual(['b']);
    });

    test('the logs of several repositories read as one history, newest first', () => {
        const { rows, more } = mergeLogs([log('one', [500, 400], null), log('two', [450, 300], null)]);
        expect(rows.map((entry) => entry.at)).toEqual([500, 450, 400, 300]);
        expect(rows.map((entry) => entry.repo)).toEqual(['one', 'two', 'one', 'two']);
        expect(more).toBe(false);
    });

    test('rows a later page could still slip above wait for that page', () => {
        // `one` has more to give below 400, so nothing older than 400 can be placed yet.
        const { rows, more } = mergeLogs([log('one', [500, 400], '2'), log('two', [450, 300], null)]);
        expect(rows.map((entry) => entry.at)).toEqual([500, 450, 400]);
        expect(more).toBe(true);
    });

    test('a repository whose page ran out holds nothing back', () => {
        const { rows } = mergeLogs([log('one', [500], null), log('two', [200], null)]);
        expect(rows.map((entry) => entry.at)).toEqual([500, 200]);
    });

    test('an empty log has no sections', () => {
        expect(groupCommits([], now)).toEqual([]);
    });
});
