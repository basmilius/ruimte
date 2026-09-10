import { describe, expect, test } from 'bun:test';
import type { GitCommit, GitStatus } from '@ruimte/contracts';
import { groupCommits, relativeTime } from './commit-log';
import { actionTitle, isUnmergedRefusal, phaseLabel, pushButton, splitMessage } from './git-actions';

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

const commit = (at: number, hash: string): GitCommit => ({ hash, shortHash: hash.slice(0, 7), subject: hash, author: 'Ada', at, refs: [] });

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
        expect(button.reason).toBe('Everything is already pushed.');
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
        expect(relativeTime(now - 10, now)).toBe('just now');
        expect(relativeTime(now - 5 * 60, now)).toBe('5m ago');
        expect(relativeTime(now - 3 * 3600, now)).toBe('3h ago');
        expect(relativeTime(now - 3 * 86400, now)).toBe('3d ago');
        expect(relativeTime(now - 40 * 86400, now)).toMatch(/^[A-Z][a-z]{2} \d+$/);
    });

    test('commits fall under the day they were written on, in the order they came in', () => {
        const midnight = Math.floor(new Date('2026-09-10T00:00:00').getTime() / 1000);
        const sections = groupCommits([commit(midnight + 3600, 'a'), commit(midnight - 3600, 'b'), commit(midnight - 5 * 86400, 'c')], now);

        expect(sections.map((section) => section.label)).toEqual(['Today', 'Yesterday', expect.any(String)]);
        expect(sections[0]?.commits.map((entry) => entry.hash)).toEqual(['a']);
        expect(sections[1]?.commits.map((entry) => entry.hash)).toEqual(['b']);
    });

    test('an empty log has no sections', () => {
        expect(groupCommits([], now)).toEqual([]);
    });
});
