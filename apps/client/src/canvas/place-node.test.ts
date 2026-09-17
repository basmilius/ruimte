import { describe, expect, test } from 'bun:test';
import { intersects } from '@/canvas/math';
import { nearestFreeNodeRect } from './place-node';

describe('nearestFreeNodeRect', () => {
    test('uses the preferred center when it is free', () => {
        expect(nearestFreeNodeRect([], { w: 320, h: 240 }, { x: 400, y: 300 })).toEqual({ x: 240, y: 184, w: 320, h: 240 });
    });

    test('places a new node near the center without covering existing nodes', () => {
        const existing = [
            { x: 240, y: 176, w: 320, h: 240 },
            { x: 600, y: 176, w: 320, h: 240 },
            { x: -120, y: 176, w: 320, h: 240 }
        ];
        const placed = nearestFreeNodeRect(existing, { w: 320, h: 240 }, { x: 400, y: 300 });

        expect(existing.some((node) => intersects(placed, node))).toBe(false);
        expect(placed).not.toEqual(existing[0]);
    });
});
