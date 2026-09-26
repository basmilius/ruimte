import { describe, expect, test } from 'bun:test';
import { WIPE_KEY_STEP, splitAt, splitForKey } from './wipe.ts';

describe('splitAt', () => {
    test('the pointer names its share of the frame', () => {
        expect(splitAt(150, { left: 100, width: 200 })).toBe(0.25);
    });

    test('a pointer past an edge holds the handle at that edge', () => {
        expect(splitAt(40, { left: 100, width: 200 })).toBe(0);
        expect(splitAt(400, { left: 100, width: 200 })).toBe(1);
    });

    test('a frame without a width moves nothing', () => {
        expect(splitAt(150, { left: 100, width: 0 })).toBeNull();
    });
});

describe('splitForKey', () => {
    test('the arrows move the handle a step', () => {
        expect(splitForKey(0.5, 'ArrowLeft')).toBeCloseTo(0.5 - WIPE_KEY_STEP);
        expect(splitForKey(0.5, 'ArrowRight')).toBeCloseTo(0.5 + WIPE_KEY_STEP);
    });

    test('a step never leaves the frame', () => {
        expect(splitForKey(0.01, 'ArrowLeft')).toBe(0);
        expect(splitForKey(0.99, 'ArrowRight')).toBe(1);
    });

    test('Home and End go to the edges', () => {
        expect(splitForKey(0.5, 'Home')).toBe(0);
        expect(splitForKey(0.5, 'End')).toBe(1);
    });

    test('any other key is left to what is around the handle', () => {
        expect(splitForKey(0.5, 'ArrowUp')).toBeNull();
        expect(splitForKey(0.5, 'a')).toBeNull();
    });
});
