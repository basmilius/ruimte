import { describe, expect, test } from 'bun:test';
import type { DiagramDocument, DiagramNode } from '@ruimte/contracts';
import { createDiagramStore, DIAGRAM_HISTORY_LIMIT } from './diagram';

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

const doc = (rev: number, ...nodes: DiagramNode[]): DiagramDocument => ({
    version: 1,
    rev,
    meta: { title: '', direction: 'right' },
    nodes,
    groups: [],
    edges: [{ from: 'a', to: 'b' }]
});

/* A store with a small graph loaded, the way the client hands one to a cell. */
const loaded = () => {
    const store = createDiagramStore();
    store.getState().load('view-1', doc(3, { id: 'a', label: 'Client' }, { id: 'b', label: 'Daemon' }), null);
    return store;
};

const nodeOf = (store: ReturnType<typeof loaded>, id: string): DiagramNode => store.getState().content.nodes.find((node) => node.id === id)!;

describe('the handles of the diagram store', () => {
    test('dragging a node writes whole numbers into pos, and the layout puts the box there', () => {
        const store = loaded();
        store.getState().moveNode('b', [400.4, 219.6], true);
        expect(nodeOf(store, 'b').pos).toEqual([400, 220]);
        expect(store.getState().layout.nodes.find((box) => box.id === 'b')).toMatchObject({ x: 400, y: 220, pinned: true });
        expect(store.getState().edits).toBe(1);
    });

    test('a drag is one step back, however many moves it took', () => {
        const store = loaded();
        store.getState().moveNode('b', [100, 100], true);
        store.getState().moveNode('b', [140, 120], false);
        store.getState().moveNode('b', [180, 140], false);
        expect(store.getState().past).toHaveLength(1);
        expect(store.getState().edits).toBe(3);
        store.getState().undo();
        expect(nodeOf(store, 'b').pos).toBeUndefined();
    });

    test('resetting a position hands the node back to the layout, and does nothing on a node that has none', () => {
        const store = loaded();
        store.getState().resetPosition('a');
        expect(store.getState().edits).toBe(0);
        store.getState().moveNode('a', [500, 500], true);
        store.getState().resetPosition('a');
        expect('pos' in nodeOf(store, 'a')).toBe(false);
        expect(store.getState().layout.nodes.find((box) => box.id === 'a')?.pinned).toBe(false);
    });

    test('undo and redo step through every handle and count as edits, so the client saves them', () => {
        const store = loaded();
        store.getState().moveNode('a', [40, 40], true);
        store.getState().resetPosition('a');
        store.getState().undo();
        expect(nodeOf(store, 'a').pos).toEqual([40, 40]);
        store.getState().undo();
        expect('pos' in nodeOf(store, 'a')).toBe(false);
        store.getState().redo();
        expect(nodeOf(store, 'a').pos).toEqual([40, 40]);
        expect(store.getState().future).toHaveLength(1);
        expect(store.getState().edits).toBe(5);
        // A new change after an undo drops the steps that were ahead of it.
        store.getState().moveNode('a', [0, 0], true);
        expect(store.getState().future).toHaveLength(0);
    });

    test('an unknown node id changes nothing', () => {
        const store = loaded();
        store.getState().moveNode('nope', [1, 2], true);
        store.getState().resetPosition('nope');
        expect(store.getState().edits).toBe(0);
        expect(store.getState().past).toHaveLength(0);
    });

    test('the history keeps its limit, and a document from disk starts it over', () => {
        const store = loaded();
        for (let i = 0; i < DIAGRAM_HISTORY_LIMIT + 5; i++) {
            store.getState().moveNode('a', [i * 10, 0], true);
        }
        expect(store.getState().past).toHaveLength(DIAGRAM_HISTORY_LIMIT);
        store.getState().applyDocument(doc(9, { id: 'a', label: 'Client' }));
        expect(store.getState().past).toHaveLength(0);
        expect(store.getState().future).toHaveLength(0);
    });
});
