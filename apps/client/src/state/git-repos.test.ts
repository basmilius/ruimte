import { describe, expect, test } from 'bun:test';
import type { GitRepo } from '@ruimte/contracts';
import type { GitFile, GitStatus } from '@ruimte/contracts';
import { headMoved, soleRepo, visibleRepos, withoutNestedRepos } from './git-repos.ts';

const file = (path: string, state: GitFile['state']): GitFile => ({
    path,
    state,
    status: state === 'untracked' ? '?' : 'M',
    added: 1,
    deleted: 0,
    binary: false
});

const status = (files: GitFile[]): GitStatus => ({
    repo: true,
    root: '/work/app',
    branch: 'main',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    base: null,
    mergeBase: null,
    files,
    truncated: false,
    live: true
});

const repos: GitRepo[] = [
    { path: '/work/app', label: 'app', kind: 'root' },
    { path: '/work/app/backend', label: 'backend', kind: 'submodule' },
    { path: '/work/app/frontend', label: 'frontend', kind: 'submodule' }
];

describe('which repositories the panel draws', () => {
    test('the ones a person hid are out, by the label they were hidden under', () => {
        expect(visibleRepos(repos, ['backend']).map((repo) => repo.label)).toEqual(['app', 'frontend']);
    });

    test('a label nobody has anymore hides nothing', () => {
        expect(visibleRepos(repos, ['tools'])).toEqual(repos);
    });

    test('hiding every one of them leaves the panel with none, not with all', () => {
        expect(visibleRepos(repos, ['app', 'backend', 'frontend'])).toEqual([]);
    });

    test('a machine without the verb answers with the folder itself', () => {
        expect(soleRepo('/work/app')).toEqual([{ path: '/work/app', label: 'app', kind: 'root' }]);
    });
});

describe('a repository inside another', () => {
    const others = ['/work/app', '/work/app/inner'];

    test('the untracked folder it shows up as in the one above it is dropped', () => {
        const before = status([file('inner/', 'untracked'), file('a.ts', 'unstaged')]);
        expect(withoutNestedRepos(before, '/work/app', others)?.files.map((entry) => entry.path)).toEqual(['a.ts']);
    });

    test('a tracked change at that path stays, which is what a submodule gitlink is', () => {
        const before = status([file('inner', 'unstaged')]);
        expect(withoutNestedRepos(before, '/work/app', others)).toBe(before);
    });

    test('a checkout with nothing inside it keeps the very status it was given', () => {
        const before = status([file('a.ts', 'untracked')]);
        expect(withoutNestedRepos(before, '/work/app/inner', others)).toBe(before);
        expect(withoutNestedRepos(null, '/work/app', others)).toBeNull();
    });
});

describe('when the log has to be read again', () => {
    test('the first status of a checkout always counts as a move', () => {
        expect(headMoved(null, status([]))).toBe(true);
    });

    test('a file that changed moves no commit', () => {
        expect(headMoved(status([]), status([file('a.ts', 'unstaged')]))).toBe(false);
    });

    test('a commit, a pull and a switch all show up', () => {
        const before = status([]);
        expect(headMoved(before, { ...before, ahead: 1 })).toBe(true);
        expect(headMoved(before, { ...before, behind: 2 })).toBe(true);
        expect(headMoved(before, { ...before, branch: 'feature/x' })).toBe(true);
        expect(headMoved(before, { ...before, detached: true })).toBe(true);
        expect(headMoved(before, { ...before, upstream: 'origin/main' })).toBe(true);
        expect(headMoved(before, { ...before, mergeBase: 'abc' })).toBe(true);
    });
});
