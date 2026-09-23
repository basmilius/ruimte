import { expect, test } from 'bun:test';
import { alignmentGuides, gapGuides } from './alignment-guides';

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

const node = (x: number, y = 0) => ({ x, y, w: 480, h: 320 });

test('gaps run to the nearest neighbor on every side', () => {
    const moving = node(1000, 1000);
    expect(gapGuides([moving], [node(400, 1000), node(-400, 1000), node(1640, 1100), node(1000, 400), node(1100, 1500)])).toEqual([
        { axis: 'x', start: 880, end: 1000, position: 1160, equal: false },
        { axis: 'x', start: 1480, end: 1640, position: 1210, equal: false },
        { axis: 'y', start: 720, end: 1000, position: 1240, equal: false },
        { axis: 'y', start: 1320, end: 1500, position: 1290, equal: false }
    ]);
});

test('a neighbor has to overlap on the cross axis', () => {
    expect(gapGuides([node(1000)], [node(400, 320), node(400, -400)])).toEqual([]);
    expect(gapGuides([node(1000)], [node(400, 319)])).toEqual([{ axis: 'x', start: 880, end: 1000, position: 319.5, equal: false }]);
});

test('a touching neighbor blocks the view past it', () => {
    expect(gapGuides([node(1000)], [node(520), node(0)])).toEqual([]);
});

test('a gap equal to one between two other nodes lights up both', () => {
    expect(gapGuides([node(1056)], [node(0), node(528)])).toEqual([
        { axis: 'x', start: 1008, end: 1056, position: 160, equal: true },
        { axis: 'x', start: 480, end: 528, position: 160, equal: true }
    ]);
});

test('an equal gap on the other axis does not count', () => {
    expect(gapGuides([node(1056)], [node(528), node(528, 368)])).toEqual([{ axis: 'x', start: 1008, end: 1056, position: 160, equal: false }]);
});

test('a resized node measures from its new edges', () => {
    expect(gapGuides([{ x: 1056, y: 0, w: 240, h: 320 }], [node(0), node(528), node(1344)])).toEqual([
        { axis: 'x', start: 1008, end: 1056, position: 160, equal: true },
        { axis: 'x', start: 1296, end: 1344, position: 160, equal: true },
        { axis: 'x', start: 480, end: 528, position: 160, equal: true }
    ]);
});

test('a block centered between two neighbors lights up both of its gaps', () => {
    expect(gapGuides([node(600)], [node(0), node(1200)])).toEqual([
        { axis: 'x', start: 480, end: 600, position: 160, equal: true },
        { axis: 'x', start: 1080, end: 1200, position: 160, equal: true }
    ]);
});

test('several moving nodes are measured as one block', () => {
    expect(gapGuides([node(600), node(600, 400)], [node(0, 400)])).toEqual([{ axis: 'x', start: 480, end: 600, position: 560, equal: false }]);
    expect(gapGuides([], [node(0)])).toEqual([]);
});
