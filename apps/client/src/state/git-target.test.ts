import { describe, expect, test } from 'bun:test';
import type { CanvasNode } from './canvas.ts';
import { gitTarget } from './git-target.ts';

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

    test('a canvas without a folder has nothing to point at', () => {
        expect(gitTarget({}, [], null)).toEqual({ cwd: null, label: '', branch: null, kind: 'project' });
    });

    test('a selected bound group points the panel at its worktree', () => {
        expect(gitTarget(nodes(group, inside), ['g1'], '/repo')).toEqual({ cwd: '/wt/feature', label: 'feature/x', branch: 'feature/x', kind: 'worktree' });
    });

    test('so does a node that sits inside one', () => {
        expect(gitTarget(nodes(group, inside), ['n1'], '/repo').cwd).toBe('/wt/feature');
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
