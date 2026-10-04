import { describe, expect, test } from 'bun:test';
import type { GitFile, GitFileState } from '@ruimte/contracts';
import {
    activeDiff,
    allCollapseKeys,
    allDirs,
    branchesUnder,
    checkOf,
    checkOfAll,
    checkPart,
    collapsedPathsOf,
    entriesOf,
    entriesUnder,
    entryParts,
    expansionChanges,
    gitTreeScope,
    groupKey,
    mergeCollapsedPaths,
    repoKey,
    shownFile,
    statusColor,
    statusOf,
    stopBeside,
    toggleOf,
    type GitTreeRow
} from './git-tree.ts';

const file = (path: string, state: GitFileState = 'unstaged', status = 'M', added = 1, deleted = 0): GitFile => ({
    path,
    state,
    status,
    added,
    deleted,
    binary: false
});

const dir = (path: string, isExpanded: boolean): GitTreeRow => ({ path, kind: 'directory', isExpanded });

describe('the groups of the list', () => {
    test('a file staged and changed again is one row among the changes, partly in the index', () => {
        const entries = entriesOf([file('a.ts', 'staged'), file('a.ts', 'unstaged'), file('b.ts', 'unstaged'), file('c.ts', 'staged')]);
        expect(entries.map((entry) => [entry.path, entry.group, checkOf(entry)])).toEqual([
            ['a.ts', 'changes', 'mixed'],
            ['b.ts', 'changes', 'unchecked'],
            ['c.ts', 'changes', 'checked']
        ]);
    });

    test('a new file stays unversioned once it is staged, so ticking it never moves the row', () => {
        const untracked = entriesOf([file('new.ts', 'untracked', '?')]);
        const staged = entriesOf([file('new.ts', 'staged', 'A')]);
        const edited = entriesOf([file('new.ts', 'staged', 'A'), file('new.ts', 'unstaged', 'M')]);
        expect([untracked[0]!.group, checkOf(untracked[0]!)]).toEqual(['unversioned', 'unchecked']);
        expect([staged[0]!.group, checkOf(staged[0]!)]).toEqual(['unversioned', 'checked']);
        expect(edited.map((entry) => [entry.group, checkOf(entry)])).toEqual([['unversioned', 'mixed']]);
    });

    test('a conflict is a group of its own', () => {
        expect(entriesOf([file('x.ts', 'conflicted', 'UU')]).map((entry) => entry.group)).toEqual(['conflicts']);
    });

    test('a row opens the diff of the working tree while it has one, else the one of the index', () => {
        const [mixed] = entriesOf([file('a.ts', 'staged', 'M', 3), file('a.ts', 'unstaged', 'M', 7)]);
        const [checked] = entriesOf([file('b.ts', 'staged', 'R', 2)]);
        expect(shownFile(mixed!).state).toBe('unstaged');
        expect(shownFile(checked!).state).toBe('staged');
        // The index's letter wins: a renamed file edited afterwards is still renamed.
        expect(statusOf(entriesOf([file('c.ts', 'staged', 'R'), file('c.ts', 'unstaged', 'M')])[0]!)).toBe('R');
    });

    test('a file row counts the lines of the diff it opens, then its letter', () => {
        const [entry] = entriesOf([file('a.ts', 'staged', 'M', 3, 1), file('a.ts', 'unstaged', 'M', 7, 0)]);
        expect(entryParts(entry!).map((part) => part.text)).toEqual(['+7', 'M']);
        expect(checkPart('mixed')).toEqual({ text: '', color: 'var(--git-check-mixed)' });
    });

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
});

describe('a box over more than one file', () => {
    const entries = entriesOf([file('src/a.ts', 'staged'), file('src/deep/b.ts', 'unstaged'), file('srcx/c.ts', 'staged'), file('readme.md', 'unstaged')]);

    test('reads checked, unchecked or mixed from what is under it', () => {
        expect(checkOfAll(entriesUnder(entries, 'srcx'))).toBe('checked');
        expect(checkOfAll(entriesUnder(entries, 'src/deep'))).toBe('unchecked');
        expect(checkOfAll(entriesUnder(entries, 'src'))).toBe('mixed');
        expect(checkOfAll([])).toBe('unchecked');
    });

    test('a folder holds the files under it, however deep, and not the ones beside it', () => {
        expect(entriesUnder(entries, 'src').map((entry) => entry.path)).toEqual(['src/a.ts', 'src/deep/b.ts']);
    });

    test('ticking one that is not wholly checked stages what is not staged yet', () => {
        expect(toggleOf(entriesUnder(entries, 'src'))).toEqual({ staged: true, paths: ['src/deep/b.ts'] });
    });

    test('ticking a checked one unstages all of it', () => {
        expect(toggleOf(entriesUnder(entries, 'srcx'))).toEqual({ staged: false, paths: ['srcx/c.ts'] });
    });

    test('a file staged and changed again is staged whole', () => {
        expect(toggleOf(entriesOf([file('a.ts', 'staged'), file('a.ts', 'unstaged')]))).toEqual({ staged: true, paths: ['a.ts'] });
    });
});

describe('the folders a group folds', () => {
    test('every folder on the way counts as one to fold up', () => {
        expect(allDirs(['apps/client/a.ts', 'readme.md'])).toEqual(['apps', 'apps/client']);
    });

    test('a folder of one repository among several is folded up under that repository', () => {
        expect(allDirs(['src/a.ts'], 'backend')).toEqual(['backend/src']);
    });

    test('collapse all names every folder once per group a file is in', () => {
        const files = [file('src/a.ts'), file('src/a.ts', 'staged'), file('src/deep/b.ts', 'staged', 'A'), file('src/c.ts', 'untracked', '?')];
        const collapsed = new Set(allCollapseKeys(files, '/repo'));
        expect([...collapsed].sort()).toEqual(
            [
                `${gitTreeScope('/repo', 'changes')}/src`,
                `${gitTreeScope('/repo', 'unversioned')}/src`,
                `${gitTreeScope('/repo', 'unversioned')}/src/deep`
            ].sort()
        );
    });

    test('a group and a repository fold under keys no folder key starts with', () => {
        const scope = gitTreeScope('/repo', 'changes');
        for (const key of [groupKey('changes'), repoKey('/repo', 'changes')]) {
            expect(`${scope}/src`.startsWith(`${key}/`)).toBe(false);
            expect(key.startsWith(`${scope}/`)).toBe(false);
        }
        expect(branchesUnder([], [repoKey('/repo', 'changes')], ['src'], scope)).toEqual([]);
    });
});

describe('which folders stand folded up', () => {
    test('two groups of the same checkout fold the same folder apart', () => {
        const changes = gitTreeScope('/repo', 'changes');
        const unversioned = gitTreeScope('/repo', 'unversioned');
        const collapsed = collapsedPathsOf([dir('src/', false)], changes);

        expect(mergeCollapsedPaths(collapsed, [dir('src/', true)], unversioned)).toBe(collapsed);
        expect(expansionChanges([dir('src/', true)], new Set(collapsed), changes)).toEqual({ collapse: ['src/'], expand: [] });
        expect(expansionChanges([dir('src/', false)], new Set(collapsed), unversioned)).toEqual({ collapse: [], expand: ['src/'] });
        expect(branchesUnder([], collapsed, ['src', 'src/deep'], unversioned)).toEqual([]);
        expect(branchesUnder([], collapsed, ['src', 'src/deep'], changes)).toEqual(['src/deep']);
    });

    test('a checkout scope cannot be mistaken for a descendant folder', () => {
        const parent = gitTreeScope('/repo', 'changes');
        const child = gitTreeScope('/repo/src', 'changes');
        const collapsed = collapsedPathsOf([dir('src/', false)], parent);

        expect(branchesUnder([], collapsed, ['deep'], child)).toEqual([]);
        expect(expansionChanges([dir('src/', true)], new Set(collapsed), child)).toEqual({ collapse: [], expand: [] });
    });

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

describe('the keyboard between the stops of the list', () => {
    const order = ['group:changes', 'repo:a', 'tree:a', 'repo:b', 'tree:b', 'group:unversioned', 'tree:c'];

    test('goes to the next stop on screen and passes over the ones a fold hides', () => {
        const shown = new Set(['group:changes', 'repo:a', 'repo:b', 'tree:b', 'group:unversioned']);
        const present = (id: string): boolean => shown.has(id);
        expect(stopBeside(order, present, 'repo:a', 1)).toBe('repo:b');
        expect(stopBeside(order, present, 'repo:b', -1)).toBe('repo:a');
        expect(stopBeside(order, present, 'group:unversioned', 1)).toBeNull();
        expect(stopBeside(order, present, 'group:changes', -1)).toBeNull();
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
