import { describe, expect, test } from 'bun:test';
import { PLACEMENT_GAP, placeBeside, placeFree } from './placement.ts';

const size = { w: 320, h: 240 };

describe('placeBeside', () => {
    test('puts the node right of the anchor with its top level', () => {
        expect(placeBeside({ x: 10, y: 20, w: 100, h: 50 }, size)).toEqual({ x: 110 + PLACEMENT_GAP, y: 20, ...size });
    });

    test('follows the anchor wherever it is, never the row the others are on', () => {
        const anchor = { x: -4000, y: 2400, w: 320, h: 240 };
        expect(placeBeside(anchor, size)).toEqual({ x: -4000 + 320 + PLACEMENT_GAP, y: 2400, ...size });
    });

    test('rounds to whole pixels', () => {
        expect(placeBeside({ x: 0.4, y: 7.6, w: 99.3, h: 50 }, size)).toEqual({ x: 140, y: 8, ...size });
    });
});

describe('placeFree', () => {
    test('an empty canvas starts at the origin', () => {
        expect(placeFree([], size, null)).toEqual({ x: 0, y: 0, ...size });
    });

    test('without a caller it goes right of everything, level with the top', () => {
        const existing = [
            { x: 0, y: 100, w: 200, h: 200 },
            { x: 500, y: -50, w: 100, h: 100 }
        ];
        expect(placeFree(existing, size, null)).toEqual({ x: 600 + PLACEMENT_GAP, y: -50, ...size });
    });

    test('beside the caller when that spot is free', () => {
        const caller = { x: 0, y: 0, w: 560, h: 360 };
        expect(placeFree([caller], size, caller)).toEqual({ x: 560 + PLACEMENT_GAP, y: 0, ...size });
    });

    test('walks right past whatever is in the way of the caller', () => {
        const caller = { x: 0, y: 0, w: 560, h: 360 };
        const first = { x: 600, y: 0, w: 320, h: 240 };
        const second = { x: 960, y: 100, w: 320, h: 240 };
        const below = { x: 600, y: 2000, w: 320, h: 240 };
        const spot = placeFree([caller, first, second, below], size, caller);
        expect(spot).toEqual({ x: 1280 + PLACEMENT_GAP, y: 0, ...size });
    });

    test('keeps a gap to a neighbor that only nearly touches', () => {
        const caller = { x: 0, y: 0, w: 100, h: 100 };
        const near = { x: 100 + PLACEMENT_GAP + size.w + 10, y: 0, w: 100, h: 100 };
        expect(placeFree([caller, near], size, caller).x).toBe(near.x + near.w + PLACEMENT_GAP);
    });
});
