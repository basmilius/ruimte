import { describe, expect, test } from 'bun:test';
import { groupFrame } from '@ruimte/contracts';
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
        // The frame the daemon's `group` verb draws around the same nodes, which is the point of sharing it.
        expect(group).toMatchObject(groupFrame([node('a', 100, 100), node('b', 400, 100)])!);

        useCanvas.getState().moveSelected(16, 8);
        const after = useCanvas.getState().nodes;
        expect(after.a).toMatchObject({ x: 116, y: 108 });
        expect(after.b).toMatchObject({ x: 416, y: 108 });
        expect(after[groupId!]).toMatchObject({ x: group.x + 16, y: group.y + 8 });
    });
});

describe('edges', () => {
    const seed = (): void => {
        useCanvas.setState({
            nodes: {
                shell: node('shell', 0, 0),
                page: node('page', 400, 0, 'browser'),
                memo: node('memo', 0, 400, 'note'),
                frame: node('frame', 400, 400, 'group')
            },
            texts: { t1: { id: 't1', x: 800, y: 0, text: 'hello', size: 18 } },
            order: ['shell', 'page', 'memo', 'frame'],
            edges: [],
            selection: [],
            linkDraft: null
        });
    };

    test('any node or text connects to any other, and only a line into an agent is labeled context', () => {
        seed();
        const s = useCanvas.getState();
        expect(s.addEdge('page', 'memo')).not.toBeNull();
        expect(s.addEdge('memo', 'frame')).not.toBeNull();
        expect(s.addEdge('frame', 't1')).not.toBeNull();
        expect(s.addEdge('t1', 'shell')).not.toBeNull();
        expect(useCanvas.getState().edges.map((edge) => edge.label)).toEqual([undefined, undefined, undefined, 'context']);
    });

    test('a pair gets one line whichever way it is drawn, and nothing connects to itself or to a stranger', () => {
        seed();
        const s = useCanvas.getState();
        expect(s.addEdge('page', 'memo')).not.toBeNull();
        expect(s.addEdge('memo', 'page')).toBeNull();
        expect(s.addEdge('page', 'page')).toBeNull();
        expect(s.addEdge('page', 'missing')).toBeNull();
        expect(useCanvas.getState().edges).toHaveLength(1);
    });

    test('"Connect to..." aims a draft from the node until a target is added', () => {
        seed();
        useCanvas.getState().startLink('page');
        expect(useCanvas.getState().linkDraft).toMatchObject({ from: 'page', aiming: true, to: { x: 500, y: 50 } });
        useCanvas.getState().addEdge('page', 'shell');
        expect(useCanvas.getState().linkDraft).toBeNull();
    });
});

describe('notes', () => {
    test('a note starts empty with the default title and keeps its body and color through updateNode', () => {
        useCanvas.setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const id = useCanvas.getState().addNode('note', { x: 0, y: 0 })!;
        expect(useCanvas.getState().nodes[id]).toMatchObject({ kind: 'note', title: 'Note' });
        useCanvas.getState().updateNode(id, { body: '# Hello', color: 'blue' });
        expect(useCanvas.getState().exportContent().nodes[0]).toMatchObject({ id, body: '# Hello', color: 'blue' });
    });
});
