import { describe, expect, test } from 'bun:test';
import type { FsEntry } from '@ruimte/contracts';
import { LOADING_NAME, absoluteOf, buildTreeInput, compareRows, isDirectoryPath, newlyExpanded, relativeTo, treePathOf } from './files-tree.ts';

const ROOT = '/repo';

const entry = (path: string, patch: Partial<FsEntry> = {}): FsEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    kind: 'file',
    size: 0,
    mtime: 0,
    hidden: path.slice(path.lastIndexOf('/') + 1).startsWith('.'),
    ignored: false,
    ...patch
});

const directory = (path: string, patch: Partial<FsEntry> = {}): FsEntry => entry(path, { kind: 'directory', size: null, ...patch });

describe('paths', () => {
    test('crosses between the daemon\u2019s absolute path and the tree\u2019s relative one', () => {
        expect(relativeTo(ROOT, '/repo/src/index.ts')).toBe('src/index.ts');
        expect(relativeTo('/repo/', '/repo/src')).toBe('src');
        expect(relativeTo('C:\\repo', 'C:\\repo\\src\\index.ts')).toBe('src/index.ts');
        expect(absoluteOf(ROOT, 'src/index.ts')).toBe('/repo/src/index.ts');
        expect(absoluteOf(ROOT, 'src/')).toBe('/repo/src');
        expect(absoluteOf('C:\\repo', 'src/index.ts')).toBe('C:\\repo\\src\\index.ts');
    });

    test('a directory keeps the trailing slash the tree marks it with', () => {
        expect(treePathOf(ROOT, directory('/repo/src'))).toBe('src/');
        expect(treePathOf(ROOT, entry('/repo/README.md'))).toBe('README.md');
        expect(isDirectoryPath('src/')).toBe(true);
        expect(isDirectoryPath('src/index.ts')).toBe(false);
    });
});

describe('buildTreeInput', () => {
    const cache = new Map<string, FsEntry[]>([
        [
            ROOT,
            [directory('/repo/src'), directory('/repo/empty'), directory('/repo/node_modules', { ignored: true }), entry('/repo/.env'), entry('/repo/a.ts')]
        ],
        ['/repo/src', [entry('/repo/src/index.ts')]],
        ['/repo/empty', []]
    ]);

    test('lists what is loaded, marks what is not, and keeps an empty directory visible', () => {
        expect(buildTreeInput(ROOT, cache, false).paths).toEqual(['src/index.ts', 'empty/', `node_modules/${LOADING_NAME}`, 'a.ts']);
    });

    test('hidden entries wait for the eye button, and nothing is asked of the daemon for them', () => {
        expect(buildTreeInput(ROOT, cache, true).paths).toContain('.env');
        expect(buildTreeInput(ROOT, cache, false).paths).not.toContain('.env');
    });

    test('what git ignores goes to the git lane, a directory with its trailing slash', () => {
        expect(buildTreeInput(ROOT, cache, false).ignored).toEqual(['node_modules/']);
    });

    test('an empty cache is an empty tree, not a throw', () => {
        expect(buildTreeInput(ROOT, new Map(), false)).toEqual({ paths: [], ignored: [] });
    });
});

describe('newlyExpanded', () => {
    test('names only the directories that opened since the last look', () => {
        expect(newlyExpanded(new Set(['src/']), new Set(['src/', 'docs/']))).toEqual(['docs/']);
        expect(newlyExpanded(new Set(['src/']), new Set())).toEqual([]);
    });
});

describe('compareRows', () => {
    test('directories first, then numbers the way a person reads them', () => {
        const rows = [
            { basename: 'item10.txt', isDirectory: false },
            { basename: 'item2.txt', isDirectory: false },
            { basename: 'src', isDirectory: true }
        ];
        expect([...rows].sort(compareRows).map((row) => row.basename)).toEqual(['src', 'item2.txt', 'item10.txt']);
    });
});
