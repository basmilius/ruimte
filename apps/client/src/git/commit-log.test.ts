import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { GitCommit } from '@ruimte/contracts';
import { githubPicture, groupCommits, mergeLogs, shownRefs, type LoadedLog, type LogRow } from './commit-log';

function seconds(local: string): number {
    return new Date(local).getTime() / 1000;
}

function commit(at: number, hash: string): GitCommit {
    return { hash, shortHash: hash.slice(0, 7), subject: hash, author: 'Ada', at, refs: [] };
}

function row(at: number, hash: string): LogRow {
    return { ...commit(at, hash), cwd: '/repo', repo: '' };
}

function commitAt(local: string): LogRow {
    return row(seconds(local), local);
}

function log(repo: string, ats: number[], cursor: string | null): LoadedLog {
    return { cwd: `/work/${repo}`, repo, commits: ats.map((at) => commit(at, `${repo}-${at}`)), cursor };
}

describe('groupCommits', () => {
    // The clock moves in Amsterdam on 29 March and 25 October 2026, so the day before has 23 or 25 hours.
    const zone = process.env.TZ;
    beforeAll(() => {
        process.env.TZ = 'Europe/Amsterdam';
    });
    afterAll(() => {
        if (zone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = zone;
        }
    });

    test('a commit from last night is under Yesterday', () => {
        const sections = groupCommits([commitAt('2026-10-13T09:00:00'), commitAt('2026-10-12T23:30:00')], seconds('2026-10-13T10:00:00'));
        expect(sections.map((section) => section.label)).toEqual(['Today', 'Yesterday']);
    });

    test('the day after the clocks went forward still has a Yesterday', () => {
        const sections = groupCommits([commitAt('2026-03-29T12:00:00')], seconds('2026-03-30T10:00:00'));
        expect(sections.map((section) => section.label)).toEqual(['Yesterday']);
    });

    test('the day after the clocks went back still has a Yesterday', () => {
        const sections = groupCommits([commitAt('2026-10-25T12:00:00')], seconds('2026-10-26T10:00:00'));
        expect(sections.map((section) => section.label)).toEqual(['Yesterday']);
    });

    test('commits fall under the day they were written on, in the order they came in', () => {
        const midnight = seconds('2026-09-10T00:00:00');
        const sections = groupCommits([row(midnight + 3600, 'a'), row(midnight - 3600, 'b'), row(midnight - 5 * 86400, 'c')], midnight + 12 * 3600);
        expect(sections.map((section) => section.label)).toEqual(['Today', 'Yesterday', expect.any(String)]);
        expect(sections.map((section) => section.commits.map((entry) => entry.hash))).toEqual([['a'], ['b'], ['c']]);
        expect(groupCommits([], midnight)).toEqual([]);
    });
});

describe('mergeLogs', () => {
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

    test('a commit rebased onto the top of its log stays on top, whatever its author date', () => {
        // A pull with rebase writes the commit again today, but keeps the date it was first written.
        const now = 1_800_000_000;
        const rebased = { ...commit(now - 21 * 86400, 'rebased'), committedAt: now };
        const older = [1, 2, 7].map((days) => ({ ...commit(now - days * 86400, `old-${days}`), committedAt: now - days * 86400 }));
        const { rows } = mergeLogs([{ cwd: '/work/one', repo: '', commits: [rebased, ...older], cursor: '4' }]);
        expect(rows.map((entry) => entry.hash)).toEqual(['rebased', 'old-1', 'old-2', 'old-7']);
    });

    test('several logs merge on the commit date and keep the order of git within each', () => {
        const stamped = (hash: string, at: number, committedAt: number): GitCommit => ({ ...commit(at, hash), committedAt });
        const { rows } = mergeLogs([
            { cwd: '/work/one', repo: 'one', commits: [stamped('one-a', 100, 500), stamped('one-b', 400, 400)], cursor: null },
            { cwd: '/work/two', repo: 'two', commits: [stamped('two-a', 450, 450), stamped('two-b', 480, 300)], cursor: null }
        ]);
        expect(rows.map((entry) => entry.hash)).toEqual(['one-a', 'two-a', 'one-b', 'two-b']);
    });
});

describe('shownRefs', () => {
    test('a branch and its remote twin on one commit are one name', () => {
        expect(shownRefs({ refs: ['main', 'origin/main', 'origin/HEAD'], remoteRefs: ['origin/main', 'origin/HEAD'] })).toEqual([
            { name: 'main', tracked: 'origin/main' }
        ]);
    });

    test('a remote branch apart from its local one keeps its own name', () => {
        expect(shownRefs({ refs: ['origin/main'], remoteRefs: ['origin/main'] })).toEqual([{ name: 'origin/main', tracked: null }]);
    });

    test('a local branch with a slash is not taken for a remote', () => {
        expect(shownRefs({ refs: ['fix/a', 'a'], remoteRefs: [] })).toEqual([
            { name: 'fix/a', tracked: null },
            { name: 'a', tracked: null }
        ]);
    });

    test('a daemon without remoteRefs shows every name', () => {
        expect(shownRefs({ refs: ['main', 'origin/main'] }).map((ref) => ref.name)).toEqual(['main', 'origin/main']);
    });
});

describe('githubPicture', () => {
    test('a private address with an id points at that account', () => {
        expect(githubPicture('123+bas@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/123?s=32');
    });

    test('an older private address points at the login', () => {
        expect(githubPicture('bas@users.noreply.github.com')).toBe('https://github.com/bas.png?size=32');
    });

    test('an address GitHub linked to an account points at that account, whatever its case', () => {
        expect(githubPicture('Bas@Example.com', new Map([['bas@example.com', 978257]]))).toBe('https://avatars.githubusercontent.com/u/978257?s=32');
    });

    test('any other address has no picture', () => {
        expect(githubPicture('bas@example.com')).toBeNull();
        expect(githubPicture('ada@example.com', new Map([['bas@example.com', 978257]]))).toBeNull();
        expect(githubPicture(undefined)).toBeNull();
    });
});
