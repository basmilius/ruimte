import { describe, expect, test } from 'bun:test';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';
import { cameraToReveal, neighboringNode } from './node-navigation';

function node(id: string, x: number, y: number): CanvasNode {
    return { id, kind: 'note', title: id, x, y, w: 100, h: 100 };
}

describe('spatial node navigation', () => {
    test('prefers a node in the same row, then falls back to diagonals without wrapping', () => {
        const nodes = [node('a', 0, 0), node('row', 400, 0), node('diagonal', 110, 110)];
        expect(neighboringNode(nodes, 'a', 'right', { x: 0, y: 0 })).toBe('row');
        expect(neighboringNode(nodes.slice(0, 1).concat(nodes[2]!), 'a', 'right', { x: 0, y: 0 })).toBe('diagonal');
        expect(neighboringNode(nodes, 'a', 'left', { x: 0, y: 0 })).toBeNull();
        expect(neighboringNode([...nodes].reverse(), null, 'right', { x: 450, y: 50 })).toBe('row');
    });

    test('hidden nodes are skipped and navigating does not give the body focus', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { a: node('a', 24, 24), b: node('b', 140, 24), c: node('c', 260, 24) }, viewport: { w: 500, h: 400 }, hidden: new Set(['b']) });
        store.getState().select(['a']);
        const before = store.getState().camera;
        store.getState().selectNeighbor('right');
        expect(store.getState().selection).toEqual(['c']);
        expect(store.getState().bodyFocusId).toBeNull();
        expect(store.getState().camera).toEqual(before);
    });

    test('starts from the last explicitly selected node in a multi-selection', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { a: node('a', 0, 0), b: node('b', 200, 0), c: node('c', 400, 0) } });
        store.getState().select(['a']);
        store.getState().select(['b'], true);
        store.getState().selectNeighbor('right');
        expect(store.getState().selection).toEqual(['c']);
    });

    test('reveals an off-screen node with the smallest pan and keeps the zoom', () => {
        expect(cameraToReveal(node('a', 1000, 0), { x: 0, y: 24, zoom: 1 }, { w: 500, h: 400 })).toEqual({ x: -624, y: 24, zoom: 1 });
    });

    test('direct zoom fits a large node and preserves selection and content focus', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { a: { ...node('a', 1000, 200), w: 2000, h: 1000 } }, viewport: { w: 1000, h: 700 }, selection: ['a'], bodyFocusId: 'a' });
        store.getState().zoomToNode();
        const state = store.getState();
        expect(state.camera.zoom).toBeCloseTo(0.452);
        expect(state.nodes.a!.x * state.camera.zoom + state.camera.x).toBeCloseTo(48);
        expect(state.selection).toEqual(['a']);
        expect(state.bodyFocusId).toBe('a');
        store.setState({ bodyFocusId: null, selection: [] });
        store.getState().zoomToNode();
        expect(store.getState().camera).toEqual(state.camera);
    });
});
