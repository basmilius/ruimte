import { describe, expect, test } from 'bun:test';
import type { CanvasNode } from '@/state/canvas-model';
import { cameraLookingAt, mappedNodes, MINIMAP_SIZE, minimapFits, minimapScale, minimapWorld, rectOnMap, waitingOnMap, worldOnMap } from './minimap-geometry';

function node(id: string, kind: CanvasNode['kind'], x: number, y: number): CanvasNode {
    return { id, kind, title: id, x, y, w: 100, h: 50 } as CanvasNode;
}

describe('the map of a canvas', () => {
    test('stands only in a cell wide enough to keep it beside the bottom center, and tall enough to keep it small', () => {
        expect(minimapFits({ w: 1028, h: 414 })).toBe(true);
        expect(minimapFits({ w: 1027, h: 800 })).toBe(false);
        expect(minimapFits({ w: 1400, h: 413 })).toBe(false);
        expect(minimapFits({ w: 0, h: 0 })).toBe(false);
    });

    test('draws groups under the nodes and leaves out the members of a collapsed group', () => {
        const nodes = { a: node('a', 'note', 0, 0), g: node('g', 'group', 0, 0), b: node('b', 'terminal', 200, 0) };
        expect(mappedNodes(nodes, new Set(['b'])).map((entry) => entry.id)).toEqual(['g', 'a']);
    });

    test('puts the dot of a node that waits inside a collapsed group on the group, once, and on the outer group when it is collapsed too', () => {
        const outer = { ...node('outer', 'group', 0, 0), collapsed: true, memberIds: ['inner', 'c'] };
        const inner = { ...node('inner', 'group', 0, 0), collapsed: true, memberIds: ['b'] };
        const group = { ...node('g', 'group', 0, 0), collapsed: true, memberIds: ['a', 'd'] };
        const nodes = {
            a: node('a', 'note', 0, 0),
            b: node('b', 'note', 0, 0),
            c: node('c', 'note', 0, 0),
            d: node('d', 'note', 0, 0),
            e: node('e', 'note', 0, 0),
            g: group,
            inner,
            outer
        };
        const hidden = new Set(['a', 'b', 'c', 'd', 'inner']);
        expect(waitingOnMap(nodes, hidden, ['a', 'd', 'b', 'c', 'e']).map((entry) => entry.id)).toEqual(['g', 'outer', 'e']);
        expect(waitingOnMap(nodes, hidden, ['gone']).map((entry) => entry.id)).toEqual([]);
    });

    test('shows the view beside the nodes, so its frame never leaves the map', () => {
        expect(minimapWorld({ x: 0, y: 0, w: 100, h: 100 }, { x: 500, y: -50, w: 100, h: 100 })).toEqual({ x: 0, y: -50, w: 600, h: 150 });
        expect(minimapWorld(null, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 10, h: 10 });
    });

    test('fits the world in the middle of the map with room at its edges, and reads a point on it back', () => {
        const map = minimapScale({ x: -1000, y: 0, w: 2000, h: 500 });
        expect(map.scale).toBe((MINIMAP_SIZE.w - 16) / 2000);
        const placed = rectOnMap(map, { x: -1000, y: 0, w: 2000, h: 500 });
        expect(placed.x).toBeCloseTo(8);
        expect(placed.x + placed.w).toBeCloseTo(MINIMAP_SIZE.w - 8);
        expect(placed.y + placed.h / 2).toBeCloseTo(MINIMAP_SIZE.h / 2);
        const back = worldOnMap(map, { x: placed.x + placed.w / 2, y: placed.y });
        expect(back.x).toBeCloseTo(0);
        expect(back.y).toBeCloseTo(0);
    });

    test('looks at a world point from the middle of the view and keeps the zoom', () => {
        expect(cameraLookingAt({ x: 10, y: 10, zoom: 0.5 }, { w: 800, h: 600 }, { x: 200, y: 100 })).toEqual({ zoom: 0.5, x: 300, y: 250 });
    });
});
