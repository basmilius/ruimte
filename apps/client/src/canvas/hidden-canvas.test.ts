import { describe, expect, test } from 'bun:test';
import { farNodeKey } from '@/canvas/culling';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';
import { readableNodes, sightOf } from '@/state/in-sight';
import { nearViewport, nodeInViewport } from '@/state/node-in-view';

function node(id: string, kind: CanvasNode['kind'], x: number): CanvasNode {
    return { id, kind, title: id, x, y: 0, w: 200, h: 100 };
}

function canvasWith(...nodes: CanvasNode[]) {
    const store = createCanvasStore();
    store.getState().loadView({ kind: 'canvas', id: 'view', name: 'Canvas', nodes, texts: [], edges: [], layouts: [] }, null);
    return store;
}

describe('a canvas in a hidden cell', () => {
    test('before a first measure everything counts as near and in sight', () => {
        const state = canvasWith(node('note', 'note', 0), node('chat', 'chat', 0)).getState();

        expect(state.viewportHidden).toBe(false);
        expect(farNodeKey(state)).toBe('');
        expect(nodeInViewport(state, 'chat')).toBe(true);
        expect(nearViewport(state, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    });

    test('measured at no size, nothing is near and nothing is in sight', () => {
        const store = canvasWith(node('note', 'note', 0), node('file', 'file', 300), node('chat', 'chat', 0));
        store.getState().setViewport({ w: 0, h: 0 });
        const state = store.getState();

        expect(state.viewportHidden).toBe(true);
        expect(farNodeKey(state).split('\n').sort()).toEqual(['file', 'note']);
        expect(nodeInViewport(state, 'chat')).toBe(false);
        expect(nearViewport(state, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
        expect(readableNodes(sightOf(state))).toEqual([]);
    });

    test('a node someone acts on stays drawn while hidden', () => {
        const store = canvasWith(node('note', 'note', 0));
        store.getState().select(['note']);
        store.getState().setViewport({ w: 0, h: 0 });

        expect(farNodeKey(store.getState())).toBe('');
    });

    test('shown again, it culls by the camera and keeps the camera it waited for', () => {
        const store = canvasWith(node('note', 'note', 0), node('far', 'note', 9000));
        store.getState().setViewport({ w: 0, h: 0 });
        store.getState().fitAll();

        expect(store.getState().pendingCamera).toEqual({ kind: 'fit' });

        store.getState().setViewport({ w: 800, h: 600 });

        expect(store.getState().viewportHidden).toBe(false);
        expect(store.getState().pendingCamera).toBeNull();
        expect(nodeInViewport(store.getState(), 'note')).toBe(true);
    });
});
