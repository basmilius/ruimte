import { describe, expect, test } from 'bun:test';
import { groupFrame, type ProjectCanvasView } from '@ruimte/contracts';
import { toWorld } from '@/canvas/math';
import { carriedByGroups, createCanvasStore, focusedCanvas, type CanvasNode } from './canvas';

/* Every test here is about one editor, and with no workspace open that is the module's own. */
const canvas = () => focusedCanvas().getState();

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
        const store = canvas();
        focusedCanvas().setState({ nodes: { a: node('a', 100, 100), b: node('b', 400, 100) }, texts: {}, order: ['a', 'b'], selection: ['a', 'b'], edges: [] });
        const groupId = store.groupSelection();
        expect(groupId).not.toBeNull();
        const group = canvas().nodes[groupId!]!;
        expect(group.kind).toBe('group');
        expect(group.x).toBeLessThan(100);
        expect(group.x + group.w).toBeGreaterThan(600);
        expect(canvas().selection).toEqual([groupId!]);
        // The frame the daemon's `node group` action draws around the same nodes, which is the point of sharing it.
        expect(group).toMatchObject(groupFrame([node('a', 100, 100), node('b', 400, 100)])!);

        canvas().moveSelected(16, 8);
        const after = canvas().nodes;
        expect(after.a).toMatchObject({ x: 116, y: 108 });
        expect(after.b).toMatchObject({ x: 416, y: 108 });
        expect(after[groupId!]).toMatchObject({ x: group.x + 16, y: group.y + 8 });
    });
});

describe('edges', () => {
    const seed = (): void => {
        focusedCanvas().setState({
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
        const s = canvas();
        expect(s.addEdge('page', 'memo')).not.toBeNull();
        expect(s.addEdge('memo', 'frame')).not.toBeNull();
        expect(s.addEdge('frame', 't1')).not.toBeNull();
        expect(s.addEdge('t1', 'shell')).not.toBeNull();
        expect(canvas().edges.map((edge) => edge.label)).toEqual([undefined, undefined, undefined, 'context']);
    });

    test('a pair gets one line whichever way it is drawn, and nothing connects to itself or to a stranger', () => {
        seed();
        const s = canvas();
        expect(s.addEdge('page', 'memo')).not.toBeNull();
        expect(s.addEdge('memo', 'page')).toBeNull();
        expect(s.addEdge('page', 'page')).toBeNull();
        expect(s.addEdge('page', 'missing')).toBeNull();
        expect(canvas().edges).toHaveLength(1);
    });

    test('"Connect to..." aims a draft from the node until a target is added', () => {
        seed();
        canvas().startLink('page');
        expect(canvas().linkDraft).toMatchObject({ from: 'page', aiming: true, to: { x: 500, y: 50 } });
        canvas().addEdge('page', 'shell');
        expect(canvas().linkDraft).toBeNull();
    });
});

describe('the camera of an editor that has not been measured', () => {
    const viewWith = (...nodes: CanvasNode[]): ProjectCanvasView => ({
        kind: 'canvas',
        id: 'view',
        name: 'Canvas',
        nodes,
        texts: [],
        edges: [],
        layouts: []
    });

    /* A view that goes into a cell gets an editor a frame before the element holding it has a size,
       so revealing a node on another view lands here. Without the wait the node ends up in the
       corner, which is the whole of the bug: the middle of a viewport of zero is (0, 0). */
    test('goToNode waits for the size instead of parking the node in the top left', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 1000, 600)), { camera: { center: { x: 600, y: 400 }, zoom: 1 }, focusedNodeId: null });

        store.getState().goToNode('a');
        expect(store.getState().pendingCamera).toEqual({ kind: 'node', id: 'a' });
        expect(store.getState().selection).toEqual(['a']);

        store.getState().setViewport({ w: 1200, h: 800 });
        expect(store.getState().pendingCamera).toBeNull();
        const { camera } = store.getState();
        expect(toWorld(camera, { x: 600, y: 400 })).toEqual({ x: 1100, y: 650 });
    });

    test('a measured editor centers on the spot and leaves nothing waiting', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 1000, 600)), { camera: { center: { x: 600, y: 400 }, zoom: 1 }, focusedNodeId: null });
        store.getState().setViewport({ w: 1200, h: 800 });

        store.getState().goToNode('a');
        expect(store.getState().pendingCamera).toBeNull();
        expect(toWorld(store.getState().camera, { x: 600, y: 400 })).toEqual({ x: 1100, y: 650 });
    });

    test('a view with no camera of its own fits itself once there is room, and an empty one waits for nothing', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 0, 0), node('b', 800, 400)), null);
        expect(store.getState().pendingCamera).toEqual({ kind: 'fit' });

        store.getState().setViewport({ w: 1200, h: 800 });
        expect(store.getState().pendingCamera).toBeNull();
        expect(toWorld(store.getState().camera, { x: 600, y: 400 })).toEqual({ x: 500, y: 250 });

        const empty = createCanvasStore();
        empty.getState().loadView(viewWith(), null);
        expect(empty.getState().pendingCamera).toBeNull();
    });

    test('a stored camera survives the first viewport and keeps its middle in any size of cell', () => {
        const store = createCanvasStore();
        const stored = { center: { x: 420, y: -180 }, zoom: 0.5 };
        store.getState().loadView(viewWith(node('a', 0, 0)), { camera: stored, focusedNodeId: null });
        expect(store.getState().pendingCamera).toEqual({ kind: 'view', view: stored });

        store.getState().setViewport({ w: 1200, h: 800 });
        expect(store.getState().pendingCamera).toBeNull();
        expect(toWorld(store.getState().camera, { x: 600, y: 400 })).toEqual(stored.center);
        expect(store.getState().viewCamera()).toEqual(stored);

        const small = createCanvasStore();
        small.getState().setViewport({ w: 400, h: 300 });
        small.getState().loadView(viewWith(node('a', 0, 0)), { camera: stored, focusedNodeId: null });
        expect(small.getState().pendingCamera).toBeNull();
        expect(toWorld(small.getState().camera, { x: 200, y: 150 })).toEqual(stored.center);
    });

    test('without a stored camera the view is fitted exactly once, not again on every resize', () => {
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 0, 0), node('b', 800, 400)), null);
        store.getState().setViewport({ w: 1200, h: 800 });
        store.getState().panBy(30, 40);
        const moved = store.getState().camera;

        store.getState().setViewport({ w: 1000, h: 700 });
        expect(store.getState().camera).toEqual(moved);
        expect(store.getState().pendingCamera).toBeNull();
    });

    test('an editor that was never measured exports the camera it was given, and nothing while it waits for a fit', () => {
        const stored = { center: { x: 10, y: 20 }, zoom: 2 };
        const store = createCanvasStore();
        store.getState().loadView(viewWith(node('a', 0, 0)), { camera: stored, focusedNodeId: null });
        expect(store.getState().viewCamera()).toBe(stored);

        const fitting = createCanvasStore();
        fitting.getState().loadView(viewWith(node('a', 0, 0)), null);
        expect(fitting.getState().viewCamera()).toBeNull();
    });

    test('two editors each keep the size of their own cell', () => {
        const left = createCanvasStore();
        const right = createCanvasStore();
        left.getState().setViewport({ w: 600, h: 800 });
        right.getState().setViewport({ w: 900, h: 400 });
        expect(left.getState().viewport).toEqual({ w: 600, h: 800 });
        expect(right.getState().viewport).toEqual({ w: 900, h: 400 });
    });
});

describe('notes', () => {
    test('a note starts empty with the default title and keeps its body and color through updateNode', () => {
        focusedCanvas().setState({ nodes: {}, texts: {}, order: [], edges: [], selection: [], viewId: 'main' });
        const id = canvas().addNode('note', { x: 0, y: 0 })!;
        expect(canvas().nodes[id]).toMatchObject({ kind: 'note', title: 'Note' });
        canvas().updateNode(id, { body: '# Hello', color: 'blue' });
        expect(canvas().exportContent().nodes[0]).toMatchObject({ id, body: '# Hello', color: 'blue' });
    });
});
