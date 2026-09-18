import { describe, expect, test } from 'bun:test';
import { markerPath } from './marker-path';

const at = { x: 100, y: 50 };
/* A line leaving the right of a node: the marker there points right, away from it. */
const right = { x: 1, y: 0 };

describe('markerPath', () => {
    test('nothing is drawn for none, or for a direction that points nowhere', () => {
        expect(markerPath('none', at, right)).toBe('');
        expect(markerPath('chevron', at, { x: 0, y: 0 })).toBe('');
    });

    test('a dot is the circle of radius 5 the ends have always worn', () => {
        expect(markerPath('dot', at, right)).toBe('M 95 50 A 5 5 0 1 0 105 50 A 5 5 0 1 0 95 50 Z');
    });

    test('a chevron is an open V with its point on the end, opening away from the node', () => {
        // Arms 6 back along the direction and 6 out to either side, and no Z: it is a stroke, not a shape.
        expect(markerPath('chevron', at, right)).toBe('M 106 56 L 100 50 L 106 44');
    });

    test('an arrow is a closed triangle, 10 long and 5 to a side', () => {
        expect(markerPath('arrow', at, right)).toBe('M 100 50 L 110 55 L 110 45 Z');
    });

    test('a diamond is a closed rhombus around the end, 6 along and 6 aside', () => {
        expect(markerPath('diamond', at, right)).toBe('M 106 50 L 100 56 L 94 50 L 100 44 Z');
    });

    test('the direction turns the shape, so an end on top points down into its node', () => {
        expect(markerPath('chevron', { x: 0, y: 0 }, { x: 0, y: -1 })).toBe('M 6 -6 L 0 0 L -6 -6');
        expect(markerPath('chevron', { x: 0, y: 0 }, { x: -1, y: 0 })).toBe('M -6 -6 L 0 0 L -6 6');
        expect(markerPath('arrow', { x: 0, y: 0 }, { x: 0, y: 1 })).toBe('M 0 0 L -5 10 L 5 10 Z');
    });

    test('only the direction of the vector is read, never its length', () => {
        expect(markerPath('arrow', at, { x: 40, y: 0 })).toBe(markerPath('arrow', at, right));
        expect(markerPath('chevron', at, { x: 0, y: -12 })).toBe(markerPath('chevron', at, { x: 0, y: -1 }));
    });
});
