import { expect, test } from 'bun:test';
import { alignmentGuides } from './alignment-guides';

const rect = { x: 80, y: 160, w: 480, h: 320 };

test('matching sides and centers share one line spanning the nodes', () => {
    expect(alignmentGuides([rect], [{ ...rect, y: 800 }])).toEqual([
        { axis: 'x', position: 80, start: 160, end: 1120 },
        { axis: 'x', position: 320, start: 160, end: 1120 },
        { axis: 'x', position: 560, start: 160, end: 1120 }
    ]);
});

test('different sizes align through their center', () => {
    const guides = alignmentGuides([rect], [{ x: 240, y: 800, w: 160, h: 160 }]);
    expect(guides).toEqual([{ axis: 'x', position: 320, start: 160, end: 960 }]);
});

test('horizontal lines support centers as well as edges', () => {
    expect(alignmentGuides([rect], [{ x: 800, y: 240, w: 240, h: 160 }])).toEqual([{ axis: 'y', position: 320, start: 80, end: 1040 }]);
});

test('alignment can match an edge to a center', () => {
    expect(alignmentGuides([rect], [{ x: 480, y: 800, w: 160, h: 160 }])).toEqual([{ axis: 'x', position: 560, start: 160, end: 960 }]);
});

test('near misses do not claim alignment after grid snapping', () => {
    expect(alignmentGuides([rect], [{ x: 84, y: 804, w: 480, h: 320 }])).toEqual([]);
});

test('duplicate matches merge their extents and disappear without targets', () => {
    expect(
        alignmentGuides(
            [rect],
            [
                { ...rect, y: 800 },
                { ...rect, y: -400 }
            ]
        )
    ).toEqual([
        { axis: 'x', position: 80, start: -400, end: 1120 },
        { axis: 'x', position: 320, start: -400, end: 1120 },
        { axis: 'x', position: 560, start: -400, end: 1120 }
    ]);
    expect(alignmentGuides([rect], [])).toEqual([]);
    expect(alignmentGuides([], [rect])).toEqual([]);
});
