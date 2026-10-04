import { expect, test } from 'bun:test';
import { nearestHandle } from './handle-hit';

test('resize handles keep a larger target without stealing their neighbours on small shapes', () => {
    const handles = [
        { kind: 'nw', x: 0, y: 0 },
        { kind: 'n', x: 8, y: 0 },
        { kind: 'ne', x: 16, y: 0 }
    ];
    expect(nearestHandle({ x: -11, y: 0 }, handles)).toBe('nw');
    expect(nearestHandle({ x: 9, y: 3 }, handles)).toBe('n');
    expect(nearestHandle({ x: 16, y: 0 }, handles)).toBe('ne');
    expect(nearestHandle({ x: 16, y: 13 }, handles)).toBeNull();
});
