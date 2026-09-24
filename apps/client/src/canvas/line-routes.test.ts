import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';
import { lineRoutes } from './line-routes';

const node = (id: string, x: number, y: number): CanvasNode => ({ id, kind: 'terminal', title: id, x, y, w: 200, h: 100 });

const view = (nodes: CanvasNode[]): ProjectCanvasView => ({
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
});

const routesOf = (store: ReturnType<typeof createCanvasStore>) => {
    const { edges, nodes, texts, hidden } = store.getState();
    return lineRoutes(edges, nodes, texts, hidden);
};

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
});
