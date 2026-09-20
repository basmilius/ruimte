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

    test('Shift preserves the ratio within grid rounding for every handle', () => {
        for (const edge of edges) {
            const result = resizedRect(rect, edge, 42, 19, { proportional: true });
            expect(Math.abs(result.h - result.w / (rect.w / rect.h))).toBeLessThanOrEqual(GRID / 2);
        }
    });

    test('Shift snaps both the driving and derived dimensions to the grid', () => {
        const result = resizedRect(rect, 'se', 42, 3, { proportional: true });
        expect((result.x + result.w) % GRID).toBe(0);
        expect(result.w).toBe(520);
        expect(result.h).toBe(344);
        expect(result.x).toBe(rect.x);
        expect(result.y).toBe(rect.y);
    });

    test('Shift on a side grows the other dimension around its center', () => {
        const result = resizedRect(rect, 'w', -42, 0, { proportional: true });
        expect(result.x + result.w).toBe(rect.x + rect.w);
        expect(Math.abs(center(result).y - center(rect).y)).toBeLessThanOrEqual(GRID / 2);
    });

    test('Alt and Shift keep center and ratio within grid rounding, including at minimum size', () => {
        for (const edge of edges) {
            for (const delta of [27, -2000, 2000]) {
                const result = resizedRect(rect, edge, delta, delta, { centered: true, proportional: true });
                expect(Math.abs(center(result).x - center(rect).x)).toBeLessThanOrEqual(GRID / 2);
                expect(Math.abs(center(result).y - center(rect).y)).toBeLessThanOrEqual(GRID / 2);
                expect(Math.abs(result.h - result.w / (rect.w / rect.h))).toBeLessThanOrEqual(GRID / 2);
                expect(result.w).toBeGreaterThanOrEqual(240);
                expect(result.h).toBeGreaterThanOrEqual(160);
            }
        }
    });

    test('fractional starting dimensions never leak into resized dimensions', () => {
        const fractional = { x: 78, y: 166, w: 402, h: 306.00000006 };
        for (const edge of edges) {
            for (const centered of [false, true]) {
                for (const proportional of [false, true]) {
                    const result = resizedRect(fractional, edge, 24, 24, { centered, proportional });
                    expect(Number.isInteger(result.w)).toBe(true);
                    expect(Number.isInteger(result.h)).toBe(true);
                    if (centered) {
                        expect(Math.abs(center(result).x - center(fractional).x)).toBeLessThanOrEqual(GRID / 2);
                        expect(Math.abs(center(result).y - center(fractional).y)).toBeLessThanOrEqual(GRID / 2);
                    }
                }
            }
        }
    });

    test('every position and dimension stays on the grid for all modifier combinations', () => {
        for (const initial of [rect, { x: 78.5, y: 165, w: 402, h: 306.00000006 }]) {
            for (const edge of edges) {
                for (const centered of [false, true]) {
                    for (const proportional of [false, true]) {
                        for (const delta of [-2000, -33.75, 0, 27.5, 2000]) {
                            const result = resizedRect(initial, edge, delta, delta / 3, { centered, proportional });
                            for (const value of Object.values(result)) {
                                expect(value / GRID).toBe(Math.round(value / GRID));
                            }
                            expect(result.w).toBeGreaterThanOrEqual(240);
                            expect(result.h).toBeGreaterThanOrEqual(160);
                        }
                    }
                }
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
