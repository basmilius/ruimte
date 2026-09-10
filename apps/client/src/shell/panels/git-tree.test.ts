import { describe, expect, test } from 'bun:test';
import type { GitFile } from '@ruimte/contracts';
import type { TabState } from '@/state/files';
import { activeDiffPath, buildGitRows } from './git-tree.ts';

const file = (path: string): GitFile => ({ path, state: 'unstaged', status: 'M', added: 1, deleted: 0, binary: false });

const shape = (paths: string[], collapsed: string[] = []): string[] =>
    buildGitRows(paths.map(file), new Set(collapsed)).map((row) =>
        row.kind === 'directory' ? `${'  '.repeat(row.depth)}${row.label}/ ${row.count}` : `${'  '.repeat(row.depth)}${row.file.path}`
    );

describe('buildGitRows', () => {
    test('files in the root keep their place and directories come first', () => {
        expect(shape(['readme.md', 'src/main.ts'])).toEqual(['src/ 1', '  src/main.ts', 'readme.md']);
    });

    test('a directory chain nothing branches in is one row', () => {
        expect(shape(['apps/client/src/state/git.ts', 'apps/client/src/state/ui.ts'])).toEqual([
            'apps/client/src/state/ 2',
            '  apps/client/src/state/git.ts',
            '  apps/client/src/state/ui.ts'
        ]);
    });

    test('the chain stops where the tree branches', () => {
        expect(shape(['apps/client/a.ts', 'apps/server/b.ts'])).toEqual([
            'apps/ 2',
            '  client/ 1',
            '    apps/client/a.ts',
            '  server/ 1',
            '    apps/server/b.ts'
        ]);
    });

    test('a collapsed directory takes its subtree with it', () => {
        expect(shape(['src/a.ts', 'src/deep/b.ts', 'readme.md'], ['src'])).toEqual(['src/ 2', 'readme.md']);
    });

    test('rows sort by name, directories and files each among themselves', () => {
        expect(shape(['b.ts', 'a.ts', 'z/1.ts', 'k/2.ts'])).toEqual(['k/ 1', '  k/2.ts', 'z/ 1', '  z/1.ts', 'a.ts', 'b.ts']);
    });
});

describe('activeDiffPath', () => {
    const diff = (path: string, cwd = '/repo') => ({
        key: `diff:${path}`,
        path,
        view: { kind: 'diff' as const, cwd, scope: 'worktree' as const, staged: false },
        pinned: false,
        dirty: false
    });

    test('names the change the preview has open, as the repository names it', () => {
        const state: TabState = { tabs: [diff('/repo/src/main.ts')], active: 'diff:/repo/src/main.ts' };
        expect(activeDiffPath(state, '/repo')).toBe('src/main.ts');
    });

    test('a file tab, another checkout and no repository at all mark nothing', () => {
        const file = { key: '/repo/a.ts', path: '/repo/a.ts', pinned: false, dirty: false };
        expect(activeDiffPath({ tabs: [file], active: '/repo/a.ts' }, '/repo')).toBeNull();
        expect(activeDiffPath({ tabs: [diff('/wt/a.ts', '/wt')], active: 'diff:/wt/a.ts' }, '/repo')).toBeNull();
        expect(activeDiffPath({ tabs: [diff('/repo/a.ts')], active: 'diff:/repo/a.ts' }, null)).toBeNull();
        expect(activeDiffPath({ tabs: [diff('/repo/a.ts')], active: null }, '/repo')).toBeNull();
    });
});
