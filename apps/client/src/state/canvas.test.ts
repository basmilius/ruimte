import { describe, expect, test } from 'bun:test';
import { carriedByGroups, useCanvas, type CanvasNode } from './canvas';

const node = (id: string, x: number, y: number, kind: CanvasNode['kind'] = 'terminal'): CanvasNode => ({ id, kind, title: id, x, y, w: 200, h: 100 });

describe('groups', () => {
    test('a group carries the nodes, texts and nested groups inside it, never the selected ones', () => {
        const nodes = {
            g: node('g', 0, 0, 'group'),
            inside: node('inside', 10, 10),
            outside: node('outside', 500, 500),
            picked: node('picked', 20, 20),
            other: node('other', 30, 30, 'group')
        };
        nodes.g.w = 400;
        nodes.g.h = 400;
        const texts = { t1: { id: 't1', x: 50, y: 50, text: 'in', size: 18 }, t2: { id: 't2', x: 900, y: 900, text: 'out', size: 18 } };
        expect([...carriedByGroups(nodes, texts, ['g', 'picked'])].sort()).toEqual(['inside', 'other', 't1']);
        expect(carriedByGroups(nodes, texts, ['inside']).size).toBe(0);
    });

    test('moving a selected group moves what it carries and groupSelection wraps the selection', () => {
        const store = useCanvas.getState();
        useCanvas.setState({ nodes: { a: node('a', 100, 100), b: node('b', 400, 100) }, texts: {}, order: ['a', 'b'], selection: ['a', 'b'], edges: [] });
        const groupId = store.groupSelection();
        expect(groupId).not.toBeNull();
        const group = useCanvas.getState().nodes[groupId!]!;
        expect(group.kind).toBe('group');
        expect(group.x).toBeLessThan(100);
        expect(group.x + group.w).toBeGreaterThan(600);
        expect(useCanvas.getState().selection).toEqual([groupId!]);

        useCanvas.getState().moveSelected(16, 8);
        const after = useCanvas.getState().nodes;
        expect(after.a).toMatchObject({ x: 116, y: 108 });
        expect(after.b).toMatchObject({ x: 416, y: 108 });
        expect(after[groupId!]).toMatchObject({ x: group.x + 16, y: group.y + 8 });
    });
});
