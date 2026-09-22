import { describe, expect, test } from 'bun:test';
import type { CanvasNode } from './canvas.ts';
import { gitTarget, gitTargets } from './git-target.ts';

const node = (id: string, over: Partial<CanvasNode> = {}): CanvasNode => ({
    id,
    kind: 'terminal',
    title: id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...over
});

const group = node('g1', { kind: 'group', x: -100, y: -100, w: 600, h: 600, worktree: { path: '/wt/feature', branch: 'feature/x' } });
const inside = node('n1', { x: 0, y: 0 });
const outside = node('n2', { x: 2000, y: 2000 });
const plain = node('g2', { kind: 'group', x: -100, y: -100, w: 600, h: 600 });

const nodes = (...list: CanvasNode[]): Record<string, CanvasNode> => Object.fromEntries(list.map((entry) => [entry.id, entry]));

describe('gitTarget', () => {
    test('without a selection the panel is on the project folder', () => {
        expect(gitTarget(nodes(group, inside), [], '/repo')).toEqual({ cwd: '/repo', label: 'repo', branch: null, kind: 'project' });
    });

    test('without an open project there is no default checkout', () => {
        expect(gitTarget({}, [], null)).toEqual({ cwd: null, label: '', branch: null, kind: 'project' });
    });

    test('a selected bound group points the panel at its worktree', () => {
        expect(gitTarget(nodes(group, inside), ['g1'], '/repo')).toEqual({ cwd: '/wt/feature', label: 'feature/x', branch: 'feature/x', kind: 'worktree' });
    });

    test('so does a node that sits inside one', () => {
        expect(gitTarget(nodes(group, inside), ['n1'], '/repo').cwd).toBe('/wt/feature');
    });

    test('a terminal whose own folder is a worktree the repository lists points the panel there', () => {
        const agent = node('t1', { cwd: '/home/worktrees/repo-1/lexer/src' });
        const worktrees = [{ path: '/home/worktrees/repo-1/lexer', branch: 'lexer' }];
        expect(gitTarget(nodes(agent), ['t1'], '/repo', worktrees)).toEqual({
            cwd: '/home/worktrees/repo-1/lexer',
            label: 'lexer',
            branch: 'lexer',
            kind: 'worktree'
        });
        expect(gitTarget(nodes(agent), ['t1'], '/repo', [{ ...worktrees[0]!, missing: true }]).cwd).toBe('/repo');
    });

    test('a collapsed group carries the members it remembers', () => {
        const collapsed = { ...group, collapsed: true, memberIds: ['n2'] };
        expect(gitTarget(nodes(collapsed, outside), ['n2'], '/repo').cwd).toBe('/wt/feature');
    });

    test('a node outside every bound group leaves the panel on the folder', () => {
        expect(gitTarget(nodes(group, outside), ['n2'], '/repo').kind).toBe('project');
    });

    test('a group without a worktree is not a target', () => {
        expect(gitTarget(nodes(plain, inside), ['g2', 'n1'], '/repo').kind).toBe('project');
    });

    test('the first selected node that is in a worktree decides', () => {
        expect(gitTarget(nodes(group, inside, outside), ['n2', 'n1'], '/repo').cwd).toBe('/wt/feature');
    });
});

describe('gitTargets', () => {
    test('a worktree whose folder is gone is no checkout to point at', () => {
        expect(gitTargets({}, [{ path: '/wt/gone', branch: 'gone', missing: true }], '/repo').map((target) => target.cwd)).toEqual(['/repo']);
    });

    test('the project folder comes first, then every worktree the daemon knows', () => {
        const worktrees = [
            { path: '/wt/feature', branch: 'feature/x' },
            { path: '/wt/fix', branch: 'fix/y' }
        ];
        expect(gitTargets(nodes(group), worktrees, '/repo')).toEqual([
            { cwd: '/repo', label: 'repo', branch: null, kind: 'project' },
            { cwd: '/wt/feature', label: 'feature/x', branch: 'feature/x', kind: 'worktree', group: 'g1' },
            { cwd: '/wt/fix', label: 'fix/y', branch: 'fix/y', kind: 'worktree' }
        ]);
    });

    test('the repositories of the folder take the place the folder itself had', () => {
        const repos = [
            { path: '/repo', label: 'repo', kind: 'root' as const },
            { path: '/repo/backend', label: 'backend', kind: 'submodule' as const }
        ];
        expect(gitTargets({}, [], '/repo', repos)).toEqual([
            { cwd: '/repo', label: 'repo', branch: null, kind: 'repo' },
            { cwd: '/repo/backend', label: 'backend', branch: null, kind: 'repo' }
        ]);
    });

    test('a folder that is no repository itself offers only the ones inside it', () => {
        const repos = [{ path: '/apps/one', label: 'one', kind: 'nested' as const }];
        expect(gitTargets({}, [], '/apps', repos)).toEqual([{ cwd: '/apps/one', label: 'one', branch: null, kind: 'repo' }]);
    });

    test('a folder that is the one repository it holds is not a repository to name', () => {
        const repos = [{ path: '/repo', label: 'repo', kind: 'root' as const }];
        expect(gitTargets({}, [], '/repo', repos)).toEqual([{ cwd: '/repo', label: 'repo', branch: null, kind: 'project' }]);
    });

    test('without an open project only supplied worktrees are offered', () => {
        expect(gitTargets({}, [{ path: '/wt/feature', branch: 'feature/x' }], null).map((target) => target.cwd)).toEqual(['/wt/feature']);
    });
});
