import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';
import { lineRoutes } from './line-routes';

function node(id: string, x: number, y: number): CanvasNode {
    return { id, kind: 'terminal', title: id, x, y, w: 200, h: 100 };
}

function view(nodes: CanvasNode[]): ProjectCanvasView {
    return {
        kind: 'canvas',
        id: 'view',
        name: 'Canvas',
        nodes,
        texts: [],
        edges: [
            { id: 'e1', from: 'a', to: 'b' },
            { id: 'e2', from: 'b', to: 'a' }
        ],
        layouts: []
    };
}

function routesOf(store: ReturnType<typeof createCanvasStore>) {
    const { edges, nodes, texts, hidden } = store.getState();
    return lineRoutes(edges, nodes, texts, hidden);
}

describe('the routes of the lines on a canvas', () => {
    test('are not found again for a pan or a zoom', () => {
        const store = createCanvasStore();
        store.getState().loadView(view([node('a', 0, 0), node('b', 600, 0), node('between', 300, -20)]), null);
        const before = routesOf(store);
        expect([...before.routes.keys()]).toEqual(['e1']);

        store.getState().panBy(120, -40);
        store.getState().zoomAt(1.5, { x: 10, y: 10 });
        expect(routesOf(store)).toBe(before);
    });

    test('are found again once a node moves', () => {
        const store = createCanvasStore();
        store.getState().loadView(view([node('a', 0, 0), node('b', 600, 0)]), null);
        const before = routesOf(store);

        store.getState().select(['b']);
        store.getState().moveSelected(0, 300, true);
        const after = routesOf(store);
        expect(after).not.toBe(before);
        expect(after.routes.get('e1')).not.toEqual(before.routes.get('e1'));
    });

    test('keep every route when a node changes what it says and not where it stands', () => {
        const store = createCanvasStore();
        store.getState().loadView(view([node('a', 0, 0), node('b', 600, 0), node('between', 300, -20)]), null);
        const before = routesOf(store);

        store.getState().renameNode('between', 'Renamed');
        const after = routesOf(store);
        expect(after).not.toBe(before);
        expect(after.routes.get('e1')).toBe(before.routes.get('e1')!);
        expect(after.lines[0]).toBe(before.lines[0]!);
    });

    test('hand back the route a line had when a node arrives that it does not pass', () => {
        const store = createCanvasStore();
        store.getState().loadView(view([node('a', 0, 0), node('b', 600, 0)]), null);
        const before = routesOf(store);

        const far = node('far', 4000, 4000);
        store
            .getState()
            .applyExternal({ nodes: [far], texts: [], edges: [], removed: { nodes: [], texts: [], edges: [] }, order: ['a', 'b', 'far'], layouts: null });
        expect(routesOf(store).routes.get('e1')).toBe(before.routes.get('e1')!);
    });
});
