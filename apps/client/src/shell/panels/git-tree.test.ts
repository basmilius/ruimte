import { describe, expect, test } from 'bun:test';
import type { GitFile, GitFileState } from '@ruimte/contracts';
import {
    activeDiff,
    allCollapseKeys,
    buildGitTree,
    byCheckout,
    checkOf,
    checkOfAll,
    checkOfItems,
    checkPart,
    collapsedPathsOf,
    compareGitRows,
    entriesOf,
    entriesUnder,
    entryParts,
    expansionChanges,
    fileId,
    flattenPaths,
    foldedBranches,
    FOLDER_JOIN,
    gitTreeScope,
    groupKey,
    itemsOfNodes,
    mergeCollapsedPaths,
    nodeOf,
    repoKey,
    shownFile,
    statusColor,
    statusOf,
    SYNTHETIC_PREFIX,
    toggleItems,
    toggleOf,
    type GitGroup,
    type GitTreeNode,
    type GitTreeRow
} from './git-tree.ts';

function file(path: string, state: GitFileState = 'unstaged', status = 'M', added = 1, deleted = 0): GitFile {
    return {
        path,
        state,
        status,
        added,
        deleted,
        binary: false
    };
}

function dir(path: string, isExpanded: boolean): GitTreeRow {
    return { path, kind: 'directory', isExpanded };
}

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

describe('folders nothing branches in', () => {
    test('a chain of lone folders is one row that stands for the deepest of them', () => {
        expect(flattenPaths(['apps/client/src/a.ts', 'apps/client/src/b.ts'])).toEqual([
            { kind: 'folder', path: 'apps/client/src', tree: `apps${FOLDER_JOIN}client${FOLDER_JOIN}src`, parent: null },
            {
                kind: 'file',
                path: 'apps/client/src/a.ts',
                tree: `apps${FOLDER_JOIN}client${FOLDER_JOIN}src/a.ts`,
                parent: `apps${FOLDER_JOIN}client${FOLDER_JOIN}src`
            },
            {
                kind: 'file',
                path: 'apps/client/src/b.ts',
                tree: `apps${FOLDER_JOIN}client${FOLDER_JOIN}src/b.ts`,
                parent: `apps${FOLDER_JOIN}client${FOLDER_JOIN}src`
            }
        ]);
    });

    test('a folder with a file of its own or a second folder ends the chain', () => {
        const nodes = flattenPaths(['src/a.ts', 'src/deep/er/b.ts', 'docs/x/y.md', 'docs/z/w.md']);
        expect(nodes.filter((node) => node.kind === 'folder').map((node) => [node.path, node.tree])).toEqual([
            ['src', 'src'],
            ['src/deep/er', `src/deep${FOLDER_JOIN}er`],
            ['docs', 'docs'],
            ['docs/x', 'docs/x'],
            ['docs/z', 'docs/z']
        ]);
    });

    test('an untracked folder git names whole is a row of its own and ends a chain', () => {
        expect(flattenPaths(['vendor/inner/'])).toEqual([
            { kind: 'folder', path: 'vendor', tree: 'vendor', parent: null },
            { kind: 'file', path: 'vendor/inner/', tree: 'vendor/inner/', parent: 'vendor' }
        ]);
    });
});

describe('the list as one tree', () => {
    const label = (group: GitGroup): string => ({ conflicts: 'Conflicts', changes: 'Changes', unversioned: 'Unversioned Files' })[group];
    const group = (name: string): string => `${SYNTHETIC_PREFIX}${name}`;
    const one = buildGitTree(
        [{ path: '/repo', label: 'repo', entries: entriesOf([file('src/state/a.ts'), file('src/state/b.ts', 'staged'), file('new.ts', 'untracked', '?')]) }],
        label
    );

    test('one checkout has a row per group and none for the repository', () => {
        expect(one.paths.sort()).toEqual(
            [
                `${group('Changes')}/src${FOLDER_JOIN}state/a.ts`,
                `${group('Changes')}/src${FOLDER_JOIN}state/b.ts`,
                `${group('Unversioned Files')}/new.ts`
            ].sort()
        );
        expect([...one.nodes.values()].map((node) => node.kind).sort()).toEqual(['file', 'file', 'file', 'folder', 'group', 'group']);
        expect(one.synthetic).toBe(1);
    });

    test('every row says what it stands for, without the lookalike slash', () => {
        const folder = one.nodes.get(`${group('Changes')}/src${FOLDER_JOIN}state`);
        expect(folder).toMatchObject({
            kind: 'folder',
            cwd: '/repo',
            path: 'src/state',
            key: `${gitTreeScope('/repo', 'changes')}/src/state`,
            parent: group('Changes')
        });
        const row = one.files.get(fileId('/repo', 'src/state/a.ts'))!;
        expect(nodeOf(one, row)).toMatchObject({ kind: 'file', cwd: '/repo', path: 'src/state/a.ts', group: 'changes' });
        expect(nodeOf(one, `${group('Changes')}/`)).toMatchObject({ kind: 'group', key: groupKey('changes') });
        for (const node of one.nodes.values()) {
            expect('path' in node ? node.path.includes(FOLDER_JOIN) : false).toBe(false);
        }
    });

    test('a group with one folder under it keeps a row of its own', () => {
        const layout = buildGitTree([{ path: '/repo', label: 'repo', entries: entriesOf([file('src/a.ts')]) }], label);
        expect(layout.paths).toEqual([`${group('Changes')}/src/a.ts`]);
    });

    test('more than one checkout has a row per repository under each group, and a slash in its label is no folder', () => {
        const layout = buildGitTree(
            [
                { path: '/work', label: 'work', entries: entriesOf([file('a.ts')]) },
                { path: '/work/packages/lib', label: 'packages/lib', entries: entriesOf([file('src/b.ts'), file('c.ts', 'untracked', '?')]) }
            ],
            label
        );
        const lib = `${SYNTHETIC_PREFIX}packages${FOLDER_JOIN}lib`;
        expect(layout.paths.sort()).toEqual(
            [`${group('Changes')}/${SYNTHETIC_PREFIX}work/a.ts`, `${group('Changes')}/${lib}/src/b.ts`, `${group('Unversioned Files')}/${lib}/c.ts`].sort()
        );
        expect(layout.nodes.get(`${group('Changes')}/${lib}`)).toMatchObject({
            kind: 'repo',
            cwd: '/work/packages/lib',
            label: 'packages/lib',
            key: repoKey('/work/packages/lib', 'changes')
        });
        expect(layout.synthetic).toBe(2);
    });

    test('two repositories that read the same still get a row each', () => {
        const layout = buildGitTree(
            [
                { path: '/a/app', label: 'app', entries: entriesOf([file('x.ts')]) },
                { path: '/b/app', label: 'app', entries: entriesOf([file('y.ts')]) }
            ],
            label
        );
        expect([...layout.nodes.values()].filter((node) => node.kind === 'repo')).toHaveLength(2);
    });

    test('groups and repositories keep their order whatever their labels say, and below them folders come first', () => {
        const dutch = (name: GitGroup): string => ({ conflicts: 'Zeta', changes: 'Beta', unversioned: 'Alpha' })[name];
        const layout = buildGitTree(
            [
                {
                    path: '/z',
                    label: 'z',
                    entries: entriesOf([file('b.ts'), file('a/c.ts'), file('u.ts', 'untracked', '?'), file('x.ts', 'conflicted', 'UU')])
                },
                { path: '/a', label: 'a', entries: entriesOf([file('d.ts')]) }
            ],
            dutch
        );
        const sorted = [...layout.paths]
            .map((path) => ({ isDirectory: false, segments: path.split('/') }))
            .sort((left, right) => compareGitRows(layout, left, right));
        expect(sorted.map((row) => row.segments.join('/'))).toEqual([
            `${SYNTHETIC_PREFIX}Zeta/${SYNTHETIC_PREFIX}z/x.ts`,
            `${SYNTHETIC_PREFIX}Beta/${SYNTHETIC_PREFIX}z/a/c.ts`,
            `${SYNTHETIC_PREFIX}Beta/${SYNTHETIC_PREFIX}z/b.ts`,
            `${SYNTHETIC_PREFIX}Beta/${SYNTHETIC_PREFIX}a/d.ts`,
            `${SYNTHETIC_PREFIX}Alpha/${SYNTHETIC_PREFIX}z/u.ts`
        ]);
    });
});

describe('a box over rows of more than one repository', () => {
    const layout = buildGitTree(
        [
            { path: '/one', label: 'one', entries: entriesOf([file('a.ts', 'staged'), file('b.ts'), file('x.ts', 'conflicted', 'UU')]) },
            { path: '/two', label: 'two', entries: entriesOf([file('c.ts'), file('d.ts', 'untracked', '?')]) }
        ],
        (group) => group
    );
    const groupOf = (name: GitGroup): GitTreeNode => [...layout.nodes.values()].find((node) => node.kind === 'group' && node.group === name)!;

    test('reads the files of every repository under it', () => {
        expect(checkOfItems(itemsOfNodes([groupOf('changes')]))).toBe('mixed');
        expect(toggleItems(itemsOfNodes([groupOf('changes')]))).toEqual({
            staged: true,
            work: [
                { cwd: '/one', paths: ['b.ts'] },
                { cwd: '/two', paths: ['c.ts'] }
            ]
        });
    });

    test('a selection over groups counts each file once and leaves conflicts out', () => {
        const nodes = [groupOf('changes'), groupOf('conflicts'), groupOf('unversioned'), ...[...layout.nodes.values()].filter((node) => node.kind === 'file')];
        const items = itemsOfNodes(nodes);
        expect(items).toHaveLength(5);
        expect(toggleItems(items).work).toEqual([
            { cwd: '/one', paths: ['b.ts'] },
            { cwd: '/two', paths: ['c.ts', 'd.ts'] }
        ]);
        expect(byCheckout(items).map(([cwd, entries]) => [cwd, entries.length])).toEqual([
            ['/one', 3],
            ['/two', 2]
        ]);
    });
});

describe('the folders a group folds', () => {
    test('collapse all names every folder row once per group a file is in', () => {
        const files = [
            file('src/a.ts'),
            file('src/a.ts', 'staged'),
            file('src/deep/b.ts', 'staged', 'A'),
            file('src/c.ts', 'untracked', '?'),
            file('apps/client/d.ts')
        ];
        const collapsed = new Set(allCollapseKeys(files, '/repo'));
        expect([...collapsed].sort()).toEqual(
            [
                `${gitTreeScope('/repo', 'changes')}/src`,
                `${gitTreeScope('/repo', 'changes')}/apps/client`,
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
    });

    test('a folder that folds takes the folders under it along, a group or a repository does not', () => {
        const layout = buildGitTree(
            [
                {
                    path: '/one',
                    label: 'one',
                    entries: entriesOf([file('src/a.ts'), file('src/state/b.ts'), file('src/state/deep/c.ts'), file('src/state/deep/d.ts')])
                },
                { path: '/two', label: 'two', entries: entriesOf([file('e.ts')]) }
            ],
            (group) => group
        );
        const keyOfPath = (path: string): string => `${gitTreeScope('/one', 'changes')}/${path}`;
        const branches = foldedBranches(layout, [], [keyOfPath('src')]);
        expect(branches.map((path) => (layout.nodes.get(path) as { path: string }).path)).toEqual(['src/state', 'src/state/deep']);
        expect(foldedBranches(layout, [keyOfPath('src')], [keyOfPath('src')])).toEqual([]);
        expect(foldedBranches(layout, [], [groupKey('changes'), repoKey('/one', 'changes')])).toEqual([]);
    });
});

describe('which rows stand folded up', () => {
    const keys: Record<string, string> = { 'g/': 'group', 'g/src/': 'folder:src', 'g/docs/': 'folder:docs' };
    const keyOf = (path: string): string | null => keys[path] ?? null;

    test('a row that is closed is one, and the trailing slash of a directory is not part of it', () => {
        expect(collapsedPathsOf([dir('src/', false), dir('apps/client/', true), { path: 'a.ts', kind: 'file', isExpanded: false }])).toEqual(['src']);
    });

    test('rows read back under the key the list names them by, and a row without one is left out', () => {
        expect(collapsedPathsOf([dir('g/', false), dir('g/src/', false), dir('g/inner/', false)], keyOf)).toEqual(['group', 'folder:src']);
    });

    test('selection notifications leave unchanged folds alone', () => {
        const current = ['folder:src', 'elsewhere'];
        expect(mergeCollapsedPaths(current, [dir('g/', true), dir('g/src/', false)], keyOf)).toBe(current);
    });

    test('fold changes keep the keys of rows the tree does not show', () => {
        const current = ['folder:src', 'hidden', 'group'];
        const next = mergeCollapsedPaths(current, [dir('g/', true), dir('g/src/', true), dir('g/docs/', false)], keyOf);
        expect(next).toEqual(['hidden', 'folder:docs']);
        expect(current).toEqual(['folder:src', 'hidden', 'group']);
    });

    test('only the rows that differ from the set move', () => {
        const rows = [dir('g/', true), dir('g/src/', true), dir('g/docs/', false), dir('g/inner/', false)];
        expect(expansionChanges(rows, new Set(['folder:src', 'elsewhere']), keyOf)).toEqual({ collapse: ['g/src/'], expand: ['g/docs/'] });
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
