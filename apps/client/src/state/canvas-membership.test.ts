import { describe, expect, test } from 'bun:test';
import { carriedByGroups, createCanvasStore, patchSnapshot, type CanvasNode } from './canvas';
import { hiddenIn, snapshotOf } from './canvas-model';

function node(id: string, x: number, y: number, size: Partial<CanvasNode> = {}): CanvasNode {
    return { id, kind: 'terminal', title: id, x, y, w: 200, h: 100, ...size };
}

function group(id: string, x: number, y: number, w: number, h: number, patch: Partial<CanvasNode> = {}): CanvasNode {
    return node(id, x, y, { kind: 'group', w, h, ...patch });
}

function storeWith(...nodes: CanvasNode[]) {
    const store = createCanvasStore();
    const byId = Object.fromEntries(nodes.map((entry) => [entry.id, entry]));
    store.setState({ viewId: 'main', nodes: byId, texts: {}, lines: {}, order: nodes.map((entry) => entry.id), hidden: hiddenIn(byId), edges: [] });
    return store;
}

function drag(store: ReturnType<typeof createCanvasStore>, ids: string[], dx: number, dy: number): void {
    store.getState().select(ids);
    store.getState().moveSelected(dx, dy, true);
    store.getState().settleMove();
}

describe('what a drop does to the groups', () => {
    test('a node dragged into a group joins it, and dragged out again leaves it', () => {
        const store = storeWith(group('frame', 0, 0, 800, 600), node('inside', 40, 80), node('free', 2000, 0));

        drag(store, ['free'], -1800, 200);

        expect(store.getState().nodes.frame!.memberIds).toEqual(['inside', 'free']);

        drag(store, ['inside'], 3000, 0);

        expect(store.getState().nodes.frame!.memberIds).toEqual(['free']);
    });

    test('of nested groups a node joins the smallest one under its center, and leaves the one it was in', () => {
        const store = storeWith(group('outer', 0, 0, 1600, 1200), group('inner', 800, 400, 600, 600), node('moving', 100, 100));

        drag(store, ['moving'], 900, 400);

        expect(store.getState().nodes.inner!.memberIds).toEqual(['moving']);
        expect(store.getState().nodes.outer!.memberIds).toEqual(['inner']);
    });

    test('moving a node within its own group keeps it there', () => {
        const store = storeWith(group('frame', 0, 0, 800, 600, { memberIds: ['inside'] }), node('inside', 40, 80));

        drag(store, ['inside'], 200, 200);

        expect(store.getState().nodes.frame!.memberIds).toEqual(['inside']);
    });

    test('two overlapping groups drag apart: only the larger holds the other, and once out it carries it no more', () => {
        const store = storeWith(group('outer', 0, 0, 1000, 1000), group('inner', 400, 400, 900, 900), node('member', 1000, 1000));

        drag(store, ['inner'], 3000, 0);

        expect(store.getState().nodes.outer!.x).toBe(0);
        expect(store.getState().nodes.member!.x).toBe(4000);
        expect(store.getState().nodes.outer!.memberIds).toEqual([]);

        drag(store, ['outer'], 0, 2000);

        expect(store.getState().nodes.inner!.y).toBe(400);
    });

    test('a group never joins a group it holds, nor itself', () => {
        const store = storeWith(
            group('big', 0, 0, 1000, 1000, { memberIds: ['small'] }),
            group('small', 400, 400, 300, 300, { memberIds: [], membersListed: true })
        );

        drag(store, ['big'], 40, 40);

        expect(store.getState().nodes.small!.memberIds).toEqual([]);
        expect(store.getState().nodes.big!.memberIds).toEqual(['small']);
    });
});

describe('what grouping, adding and resizing do to the groups', () => {
    test('grouping a selection holds exactly the selection, and a selected group keeps its own members', () => {
        const store = storeWith(
            node('a', 100, 100),
            node('b', 700, 100),
            group('nested', 80, 300, 600, 400, { memberIds: ['held'] }),
            node('held', 120, 400),
            node('between', 400, 150)
        );
        store.getState().select(['a', 'b', 'nested', 'held']);

        const id = store.getState().groupSelection()!;

        expect(store.getState().nodes[id]!.memberIds).toEqual(['a', 'b', 'nested']);
        expect(store.getState().nodes.nested!.memberIds).toEqual(['held']);
    });

    test('grouping inside a group puts the new group in that group in place of what it frames', () => {
        const store = storeWith(
            group('frame', 0, 0, 2000, 1000, { memberIds: ['a', 'b', 'c'] }),
            node('a', 100, 100),
            node('b', 400, 100),
            node('c', 1500, 500)
        );
        store.getState().select(['a', 'b']);

        const id = store.getState().groupSelection()!;

        expect(store.getState().nodes.frame!.memberIds).toEqual(['c', id]);
    });

    test('a node or a text made inside a frame joins it, and a new group takes in nothing under it', () => {
        const store = storeWith(group('frame', 0, 0, 800, 600), node('below', 1000, 1000));

        const added = store.getState().addNode('note', { x: 400, y: 300 })!;
        const text = store.getState().addText({ x: 100, y: 500 });
        const empty = store.getState().addNode('group', { x: 1100, y: 1050 })!;

        expect(store.getState().nodes.frame!.memberIds).toEqual([added, text]);
        expect(store.getState().nodes[empty]!.memberIds).toEqual([]);
    });

    test('resizing a group lets go of what falls outside and takes in nothing', () => {
        const store = storeWith(group('frame', 0, 0, 800, 600), node('near', 40, 80), node('far', 500, 400), node('outside', 1000, 80));

        store.getState().setResizing('frame');
        store.getState().resizeNode('frame', { x: 0, y: 0, w: 1400, h: 300 });
        store.getState().setResizing(null);

        expect(store.getState().nodes.frame!.memberIds).toEqual(['near']);

        store.getState().undo();

        expect(store.getState().nodes.frame!.memberIds).toBeUndefined();
    });
});

describe('folding, hiding and deleting', () => {
    test('opening and closing a group again leaves the nodes below its bar outside it', () => {
        const store = storeWith(group('frame', 0, 0, 800, 600), node('inside', 40, 80));
        store.getState().toggleCollapse('frame');
        store.setState({ nodes: { ...store.getState().nodes, below: node('below', 40, 300) } });

        store.getState().toggleCollapse('frame');

        expect(store.getState().nodes.frame!.memberIds).toEqual(['inside']);

        store.getState().toggleCollapse('frame');

        expect(store.getState().nodes.frame!.memberIds).toEqual(['inside']);
        expect([...store.getState().hidden]).toEqual(['inside']);
    });

    test('a collapsed group hides exactly what it carries, through the groups inside it', () => {
        const nodes = {
            outer: group('outer', 0, 0, 1000, 40, { collapsed: true, expandedHeight: 1000, memberIds: ['inner'] }),
            inner: group('inner', 600, 600, 900, 900),
            reaching: node('reaching', 1200, 1200)
        };

        expect([...hiddenIn(nodes)].sort()).toEqual(['inner', 'reaching']);
        expect([...carriedByGroups(nodes, {}, ['outer'])].sort()).toEqual(['inner', 'reaching']);
    });

    test('deleting a collapsed group takes what a group inside it holds, and a deleted member leaves an open group', () => {
        const store = storeWith(
            group('outer', 0, 0, 1000, 40, { collapsed: true, expandedHeight: 1000, memberIds: ['inner'] }),
            group('inner', 100, 100, 600, 600, { memberIds: ['deep'] }),
            node('deep', 200, 200),
            group('open', 3000, 0, 800, 600, { memberIds: ['one', 'two'] }),
            node('one', 3040, 80),
            node('two', 3400, 80)
        );
        store.getState().select(['outer', 'one']);

        store.getState().deleteSelected();

        expect(Object.keys(store.getState().nodes).sort()).toEqual(['open', 'two']);
        expect(store.getState().nodes.open!.memberIds).toEqual(['two']);
    });

    test('an undo step keeps a node another writer put in a group', () => {
        const before = snapshotOf({
            nodes: { frame: group('frame', 0, 0, 800, 600, { memberIds: [], membersListed: true }) },
            order: ['frame'],
            texts: {},
            lines: {},
            edges: [],
            layouts: []
        });
        const agent = node('agent', 40, 80);
        const patched = patchSnapshot(
            before,
            { nodes: [agent], texts: [], edges: [], removed: { nodes: [], texts: [], edges: [] }, order: [], layouts: null },
            [group('frame', 0, 0, 800, 600, { memberIds: ['agent'] })]
        );

        expect(patched.nodes.frame!.memberIds).toEqual(['agent']);
    });
});
