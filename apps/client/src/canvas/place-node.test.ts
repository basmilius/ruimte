import { describe, expect, test } from 'bun:test';
import { intersects } from '@/canvas-model/math';
import { liesWithin, nearestFreeNodeRect } from './place-node';

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

    test('with the center taken, it lands in view rather than up and left out of it', () => {
        const visible = { x: -100, y: 0, w: 1000, h: 800 };
        const existing = [{ x: 200, y: 288, w: 320, h: 240 }];
        const placed = nearestFreeNodeRect(existing, { w: 320, h: 240 }, { x: 400, y: 400 }, visible);

        expect(nearestFreeNodeRect(existing, { w: 320, h: 240 }, { x: 400, y: 400 }).x).toBeLessThan(visible.x);
        expect(liesWithin(visible, placed)).toBe(true);
        expect(existing.some((node) => intersects(placed, node))).toBe(false);
    });

    test('a view with no free room left falls back to the nearest free spot outside it', () => {
        const visible = { x: 0, y: 0, w: 400, h: 300 };
        const existing = [{ x: 0, y: 0, w: 400, h: 300 }];
        const placed = nearestFreeNodeRect(existing, { w: 320, h: 240 }, { x: 200, y: 150 }, visible);

        expect(liesWithin(visible, placed)).toBe(false);
        expect(existing.some((node) => intersects(placed, node))).toBe(false);
    });
});
