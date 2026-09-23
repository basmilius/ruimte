import { describe, expect, test } from 'bun:test';
import type { GitFile } from '@ruimte/contracts';
import {
    activeDiff,
    allDirs,
    branchesUnder,
    collapsedPathsOf,
    expansionChanges,
    mergeCollapsedPaths,
    pathsUnder,
    statusColor,
    type GitTreeRow
} from './git-tree.ts';

const file = (path: string, status = 'M'): GitFile => ({ path, state: 'unstaged', status, added: 1, deleted: 0, binary: false });

const dir = (path: string, isExpanded: boolean): GitTreeRow => ({ path, kind: 'directory', isExpanded });

describe('what the tree is told about a group', () => {
    test('a porcelain letter carries the color the app gives that news', () => {
        expect([statusColor('A'), statusColor('?')]).toEqual(['var(--status-idle)', 'var(--status-idle)']);
        expect(statusColor('D')).toBe('var(--status-error)');
        expect(statusColor('R')).toBe('var(--status-running)');
        // A type change, a copy and a conflict all read as a modification, the way the tree names them.
        expect([statusColor('M'), statusColor('T'), statusColor('UU')]).toEqual([
            'var(--status-needs-you)',
            'var(--status-needs-you)',
            'var(--status-needs-you)'
        ]);
    });

    test('a folder holds the files under it, however deep, and not the ones beside it', () => {
        const files = [file('src/a.ts'), file('src/deep/b.ts'), file('srcx/c.ts'), file('readme.md')];
        expect(pathsUnder(files, 'src')).toEqual(['src/a.ts', 'src/deep/b.ts']);
    });

    test('every folder on the way counts as one to fold up', () => {
        expect(allDirs([file('apps/client/a.ts'), file('readme.md')])).toEqual(['apps', 'apps/client']);
    });

    test('a folder of one repository among several is folded up under that repository', () => {
        expect(allDirs([file('src/a.ts')], 'backend')).toEqual(['backend/src']);
    });
});

describe('which folders stand folded up', () => {
    test('selection notifications from different groups leave shared folds unchanged', () => {
        const current = ['src', 'docs'];
        const staged = mergeCollapsedPaths(current, [dir('src/', false)]);
        const unstaged = mergeCollapsedPaths(staged, [dir('docs/', false)]);
        expect(staged).toBe(current);
        expect(unstaged).toBe(current);
        expect(mergeCollapsedPaths(current, [dir('docs/', false), dir('src/', false)])).toBe(current);
    });

    test('fold changes preserve hidden descendants and folders belonging to other groups', () => {
        const current = ['src', 'src/nested', 'docs'];
        const next = mergeCollapsedPaths(current, [dir('src/', true), dir('tests/', false)]);
        expect(next).toEqual(['src/nested', 'docs', 'tests']);
        expect(mergeCollapsedPaths(next, [dir('src/', true), dir('tests/', false)])).toBe(next);
        expect(current).toEqual(['src', 'src/nested', 'docs']);
    });

    test('a row that is closed is one, and the trailing slash of a directory is not part of it', () => {
        expect(collapsedPathsOf([dir('src/', false), dir('apps/client/', true), { path: 'a.ts', kind: 'file', isExpanded: false }])).toEqual(['src']);
    });

    test('two repositories fold the same folder name apart', () => {
        const current = ['backend/src'];
        expect(collapsedPathsOf([dir('src/', false)], 'frontend')).toEqual(['frontend/src']);
        // The tree of the other module says nothing about a folder it does not have.
        expect(mergeCollapsedPaths(current, [dir('src/', true)], 'frontend')).toBe(current);
        expect(mergeCollapsedPaths(current, [dir('src/', true)], 'backend')).toEqual([]);
    });

    test('a tree of one repository only moves the rows its own keys name', () => {
        const rows = [dir('src/', true)];
        expect(expansionChanges(rows, new Set(['backend/src']), 'frontend')).toEqual({ collapse: [], expand: [] });
        expect(expansionChanges(rows, new Set(['backend/src']), 'backend')).toEqual({ collapse: ['src/'], expand: [] });
    });

    test('only the rows that differ from the set move, and the folders of other groups are left alone', () => {
        const rows = [dir('src/', true), dir('apps/', false), dir('docs/', false)];
        expect(expansionChanges(rows, new Set(['src', 'apps', 'elsewhere']))).toEqual({ collapse: ['src/'], expand: ['docs/'] });
    });

    test('a folder that folds takes the folders under it along', () => {
        const dirs = ['src', 'src/state', 'src/state/deep', 'docs', 'srcs'];
        expect(branchesUnder([], ['src'], dirs)).toEqual(['src/state', 'src/state/deep']);
        expect(branchesUnder(['src'], ['src'], dirs)).toEqual([]);
        expect(branchesUnder([], ['src', 'src/state/deep'], dirs)).toEqual(['src/state']);
        expect(branchesUnder([], ['frontend/src'], dirs, 'frontend')).toEqual(['src/state', 'src/state/deep']);
    });

    test('a tree that already stands the way the set says moves nothing', () => {
        expect(expansionChanges([dir('src/', false), dir('apps/', true)], new Set(['src']))).toEqual({ collapse: [], expand: [] });
    });
});

describe('activeDiff', () => {
    const diff = (path: string, cwd = '/repo') => ({
        key: `diff:${path}`,
        path,
        view: { kind: 'diff' as const, cwd, scope: 'worktree' as const, staged: false },
        pinned: false
    });

    test('names the change the preview has open, and the checkout it belongs to', () => {
        expect(activeDiff(diff('/repo/src/main.ts'))).toEqual({ cwd: '/repo', path: 'src/main.ts' });
        expect(activeDiff(diff('/work/docksal/backend/a.ts', '/work/docksal/backend'))).toEqual({ cwd: '/work/docksal/backend', path: 'a.ts' });
    });

    test('a file tab, a tab outside its own checkout and no tab at all mark nothing', () => {
        expect(activeDiff({ key: '/repo/a.ts', path: '/repo/a.ts', pinned: false })).toBeNull();
        expect(activeDiff(diff('/elsewhere/a.ts'))).toBeNull();
        expect(activeDiff(undefined)).toBeNull();
    });
});
