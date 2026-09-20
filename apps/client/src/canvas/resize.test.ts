import { describe, expect, test } from 'bun:test';
import { GRID, type Rect } from '@/canvas/math';
import { resizedRect } from './resize';

const rect: Rect = { x: 80, y: 160, w: 480, h: 320 };
const center = (value: Rect) => ({ x: value.x + value.w / 2, y: value.y + value.h / 2 });
const edges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

describe('canvas resize', () => {
    test('a free corner snaps the dragged edges to the grid', () => {
        expect(resizedRect(rect, 'se', 26, 19)).toEqual({ x: 80, y: 160, w: 504, h: 336 });
        expect(resizedRect(rect, 'nw', 26, 19)).toEqual({ x: 104, y: 176, w: 456, h: 304 });
    });

    test('all ordinary handles keep the opposite edges fixed', () => {
        for (const edge of edges) {
            const result = resizedRect(rect, edge, 26, 19);
            if (edge.includes('w')) {
                expect(result.x + result.w).toBe(rect.x + rect.w);
            } else {
                expect(result.x).toBe(rect.x);
            }
            if (edge.includes('n')) {
                expect(result.y + result.h).toBe(rect.y + rect.h);
            } else {
                expect(result.y).toBe(rect.y);
            }
        }
    });

    test('Alt resizes around the original center with every handle', () => {
        for (const edge of edges) {
            const result = resizedRect(rect, edge, 26, 19, { centered: true });
            expect(center(result)).toEqual(center(rect));
        }
        expect(resizedRect(rect, 'e', 26, 0, { centered: true })).toEqual({ x: 56, y: 160, w: 528, h: 320 });
    });

    test('Shift preserves the ratio for every handle', () => {
        for (const edge of edges) {
            const result = resizedRect(rect, edge, 42, 19, { proportional: true });
            expect(result.w / result.h).toBeCloseTo(rect.w / rect.h, 12);
        }
    });

    test('Shift snaps the driving edge without rounding the derived dimension', () => {
        const result = resizedRect(rect, 'se', 42, 3, { proportional: true });
        expect((result.x + result.w) % GRID).toBe(0);
        expect(result.w).toBe(520);
        expect(result.h).toBeCloseTo(520 / 1.5, 12);
        expect(result.x).toBe(rect.x);
        expect(result.y).toBe(rect.y);
    });

    test('Shift on a side grows the other dimension around its center', () => {
        const result = resizedRect(rect, 'w', -42, 0, { proportional: true });
        expect(result.x + result.w).toBe(rect.x + rect.w);
        expect(center(result).y).toBe(center(rect).y);
    });

    test('Alt and Shift keep both center and ratio, including at minimum size', () => {
        for (const edge of edges) {
            for (const delta of [27, -2000, 2000]) {
                const result = resizedRect(rect, edge, delta, delta, { centered: true, proportional: true });
                expect(center(result).x).toBeCloseTo(center(rect).x, 10);
                expect(center(result).y).toBeCloseTo(center(rect).y, 10);
                expect(result.w / result.h).toBeCloseTo(rect.w / rect.h, 12);
                expect(result.w).toBeGreaterThanOrEqual(240);
                expect(result.h).toBeGreaterThanOrEqual(160);
            }
        }
    });

    test('minimum size does not move an anchored opposite edge', () => {
        expect(resizedRect(rect, 'nw', 2000, 2000)).toEqual({ x: 320, y: 320, w: 240, h: 160 });
    });

    test('modifier changes use the original rectangle, without accumulating drift', () => {
        const original = { ...rect };
        resizedRect(rect, 'se', 42, 19, { centered: true, proportional: true });
        resizedRect(rect, 'se', 42, 19, { centered: true });
        expect(rect).toEqual(original);
        expect(resizedRect(rect, 'se', 42, 19)).toEqual({ x: 80, y: 160, w: 520, h: 336 });
    });
});
