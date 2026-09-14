import { describe, expect, test } from 'bun:test';
import type { DiagramDocument } from '@ruimte/contracts';
import { createDiagramStore } from './diagram';

const document: DiagramDocument = {
    version: 1,
    rev: 3,
    meta: { title: 'Wire', direction: 'right' },
    nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' }
    ],
    groups: [],
    edges: [{ from: 'a', to: 'b' }]
};

describe('the diagram store', () => {
    test('a diagram with no stored camera is fitted the moment it has a size', () => {
        const store = createDiagramStore();
        store.getState().load('view-1', document, null);
        expect(store.getState().pendingCamera).toEqual({ kind: 'fit' });
        store.getState().setViewport({ w: 800, h: 600 });
        expect(store.getState().pendingCamera).toBeNull();
        expect(store.getState().layout.nodes.map((box) => box.id)).toEqual(['a', 'b']);
    });

    test('an empty diagram ends the wait for a fit instead of holding it', () => {
        const store = createDiagramStore();
        store.getState().load('view-1', { ...document, nodes: [], edges: [] }, null);
        expect(store.getState().pendingCamera).toBeNull();
    });

    test('a stored camera waits for a size and is handed back as it came', () => {
        const store = createDiagramStore();
        store.getState().load('view-1', document, { camera: { center: { x: 10, y: 20 }, zoom: 2 }, focusedNodeId: null });
        expect(store.getState().viewCamera()).toEqual({ center: { x: 10, y: 20 }, zoom: 2 });
    });

    test('a document from disk replaces the graph and its layout, and leaves the camera alone', () => {
        const store = createDiagramStore();
        store.getState().load('view-1', document, null);
        store.getState().setViewport({ w: 800, h: 600 });
        const camera = store.getState().camera;
        store.getState().applyDocument({ ...document, rev: 4, nodes: [{ id: 'z', label: 'Z' }], edges: [] });
        expect(store.getState().layout.nodes.map((box) => box.id)).toEqual(['z']);
        expect(store.getState().rev).toBe(4);
        expect(store.getState().camera).toBe(camera);
    });

    test('replacing the content counts an edit and lays it out again', () => {
        const store = createDiagramStore();
        store.getState().load('view-1', document, null);
        store.getState().replaceContent({ ...store.getState().content, nodes: [...document.nodes, { id: 'c', label: 'C' }] });
        expect(store.getState().edits).toBe(1);
        expect(store.getState().layout.nodes).toHaveLength(3);
    });
});
