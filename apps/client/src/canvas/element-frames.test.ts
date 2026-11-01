import { describe, expect, test } from 'bun:test';
import type { CanvasNode } from '@/state/canvas-model';
import type { CanvasState } from '@/state/canvas';
import { gapFrames } from './element-frames';

describe('canvas gap frames', () => {
    test('omits hidden elements, keeps node references and normalizes reversed line bounds', () => {
        const node = { id: 'note', kind: 'note', x: 10, y: 20, w: 100, h: 50 } as CanvasNode;

        const state = {
            nodes: Object.assign(Object.create({ inherited: { ...node, id: 'inherited' } }), { note: node, hidden: { ...node, id: 'hidden' } }),
            lines: Object.assign(Object.create({ inheritedLine: { id: 'inherited-line', x: 0, y: 0, endX: 1, endY: 1 } }), {
                line: { id: 'line', x: 80, y: 90, endX: 20, endY: 30 },
                hiddenLine: { id: 'hidden-line', x: 0, y: 0, endX: 1, endY: 1 }
            }),
            hidden: new Set(['hidden', 'hidden-line'])
        } as unknown as Pick<CanvasState, 'nodes' | 'lines' | 'hidden'>;

        const frames = gapFrames(state);
        expect(Object.keys(frames)).toEqual(['note', 'line']);
        expect(frames.note).toBe(node);
        expect(frames.line).toEqual({ id: 'line', kind: 'line', x: 20, y: 30, w: 60, h: 60 });
    });

    test('a line replaces a colliding node id and a stored __proto__ id stays an ordinary own property', () => {
        const node = { id: '__proto__', kind: 'note', x: 0, y: 0, w: 1, h: 1 } as CanvasNode;

        const state = {
            nodes: { first: node },
            lines: { second: { id: '__proto__', x: 2, y: 3, endX: 4, endY: 5 } },
            hidden: new Set<string>()
        } as unknown as Pick<CanvasState, 'nodes' | 'lines' | 'hidden'>;

        const frames = gapFrames(state);
        expect(Object.getPrototypeOf(frames)).toBe(Object.prototype);
        expect(Object.keys(frames)).toEqual(['__proto__']);
        expect(frames['__proto__']).toEqual({ id: '__proto__', kind: 'line', x: 2, y: 3, w: 2, h: 2 });
    });
});
