import { describe, expect, test } from 'bun:test';
import {
    CANVAS_GRID,
    GROUP_HEADER,
    GROUP_PADDING,
    NODE_SIZE,
    NODE_SIZE_MAX,
    NODE_SIZE_MIN,
    fitNodeSize,
    groupFrame,
    groupMemberIds,
    knownNodeSizes,
    nodeSizeOf,
    withMemberIds,
    PLACEMENT_GAP,
    arrangeRects,
    gridPoint,
    gridSide,
    rectBeside,
    spreadRects,
    type GroupItem
} from './node-defaults.ts';

describe('default node sizes', () => {
    test('a kind takes the size a machine keeps for it, and its built-in size without one', () => {
        const sizes = { terminal: { w: 800, h: 480 } };
        expect(nodeSizeOf(sizes, 'terminal')).toEqual({ w: 800, h: 480 });
        expect(nodeSizeOf(sizes, 'chat')).toEqual(NODE_SIZE.chat);
        expect(nodeSizeOf(undefined, 'note')).toEqual(NODE_SIZE.note);
    });

    test('a frame becomes whole pixels within the smallest a frame drags to and the largest a default may be', () => {
        expect(fitNodeSize({ w: 640.4, h: 399.6 })).toEqual({ w: 640, h: 400 });
        expect(fitNodeSize({ w: 100, h: 9000 })).toEqual({ w: NODE_SIZE_MIN.w, h: NODE_SIZE_MAX });
    });

    test('reads the kinds this version knows and drops a size that will not read without the others', () => {
        const raw = {
            terminal: { w: 640, h: 400 },
            chat: { w: 640.5, h: 400 },
            note: { w: 640, h: 100 },
            browser: '640x400',
            hologram: { w: 640, h: 400 }
        };
        expect(knownNodeSizes(raw)).toEqual({ terminal: { w: 640, h: 400 } });
        expect(knownNodeSizes(null)).toEqual({});
        expect(knownNodeSizes([1, 2])).toEqual({});
    });
});

describe('groupFrame', () => {
    test('keeps room on every side and a title band above what it holds', () => {
        expect(groupFrame([{ x: 104, y: 200, w: 320, h: 240 }])).toEqual({
            x: 104 - GROUP_PADDING,
            y: 200 - GROUP_PADDING - GROUP_HEADER,
            w: 320 + GROUP_PADDING * 2,
            h: 240 + GROUP_PADDING * 2 + GROUP_HEADER
        });
    });

    test('holds every member, wherever they sit', () => {
        const frame = groupFrame([
            { x: -400, y: 40, w: 200, h: 100 },
            { x: 600, y: -80, w: 320, h: 240 }
        ])!;
        expect(frame.x).toBeLessThan(-400);
        expect(frame.y).toBeLessThan(-80);
        expect(frame.x + frame.w).toBeGreaterThan(920);
        expect(frame.y + frame.h).toBeGreaterThan(160);
    });

    test('lands on the grid, whatever the members do', () => {
        const frame = groupFrame([{ x: 3.7, y: -11.2, w: 101.5, h: 99.9 }])!;
        for (const value of [frame.x, frame.y, frame.w, frame.h]) {
            expect(Math.abs(value % CANVAS_GRID)).toBe(0);
        }
    });

    test('nothing to hold is no frame', () => {
        expect(groupFrame([])).toBeNull();
    });
});

describe('groupMemberIds', () => {
    const frame = { id: 'frame', x: 0, y: 0, w: 1000, h: 1000 };
    const inside = { id: 'inside', x: 100, y: 100, w: 200, h: 200 };
    const straddling = { id: 'straddling', x: 700, y: 100, w: 400, h: 200 };
    const outside = { id: 'outside', x: 4000, y: 0, w: 100, h: 100 };
    const text = { id: 'text', x: 500, y: 500 };

    test('an open frame holds what lies in it by its center, hanging over an edge included, and a text by the point it sits on', () => {
        expect(groupMemberIds(frame, [frame, inside, straddling, outside, text])).toEqual(['inside', 'straddling', 'text']);
    });

    test('a collapsed frame holds what the file says, and only what is still there', () => {
        const folded = { ...frame, collapsed: true, expandedHeight: 1000, h: 40, memberIds: ['outside', 'gone'] };
        expect(groupMemberIds(folded, [folded, inside, outside])).toEqual(['outside']);
    });

    test('an open frame that spells out its members holds those, wherever the rest stands', () => {
        const spelled = { ...frame, memberIds: ['outside', 'gone'] };
        expect(groupMemberIds(spelled, [spelled, inside, outside, text])).toEqual(['outside']);
    });

    test('an open frame with the empty list a 0.29 iPhone wrote holds what lies in it, and one this version emptied holds nothing', () => {
        const fromOlderPhone = { ...frame, memberIds: [] };
        const emptied = withMemberIds(frame, []);

        expect(groupMemberIds(fromOlderPhone, [fromOlderPhone, inside, outside])).toEqual(['inside']);
        expect(groupMemberIds(emptied, [emptied, inside, outside])).toEqual([]);
        expect(groupMemberIds({ ...frame, collapsed: true, memberIds: [] }, [frame, inside])).toEqual([]);
    });

    test('of two overlapping frames read off positions, only the larger holds the other', () => {
        const large = { ...frame, kind: 'group' };
        const small = { id: 'small', kind: 'group', x: 400, y: 400, w: 900, h: 900 };
        const twin = { ...large, id: 'twin', x: 400, y: 400 };

        expect(groupMemberIds(large, [large, small])).toEqual(['small']);
        expect(groupMemberIds(small, [large, small])).toEqual([]);
        expect(groupMemberIds(large, [large, twin])).toEqual([]);
    });

    test('preserves item order, repeated ids and sparse inherited entries in both group modes', () => {
        const first = { id: 'a', x: 20, y: 20 };
        const repeated = { id: 'a', x: 30, y: 30 };
        const inherited = { id: 'inherited', x: 40, y: 40 };
        const items: GroupItem[] = [first];
        items.length = 6;
        items[2] = repeated;
        items[3] = frame;
        const prototype = Object.assign(Object.create(Array.prototype), { 4: inherited });
        Object.setPrototypeOf(items, prototype);
        Object.freeze(items);
        const folded = { ...frame, collapsed: true, memberIds: ['inherited', frame.id, 'a', 'missing'] };

        expect(groupMemberIds(frame, items)).toEqual(['a', 'a', 'inherited']);
        expect(groupMemberIds(folded, items)).toEqual(['a', 'a', frame.id, 'inherited']);
    });
});

describe('placing beside a frame', () => {
    const anchor = { x: 100, y: 200, w: 300, h: 150 };
    const size = { w: 80, h: 40 };

    test('a side is the anchor edge plus the gap, top edges level beside it and left edges level above and below it', () => {
        expect(rectBeside(anchor, size, 'right')).toEqual({ x: 400 + PLACEMENT_GAP, y: 200, ...size });
        expect(rectBeside(anchor, size, 'left')).toEqual({ x: 100 - PLACEMENT_GAP - 80, y: 200, ...size });
        expect(rectBeside(anchor, size, 'above', 16)).toEqual({ x: 100, y: 200 - 16 - 40, ...size });
        expect(rectBeside(anchor, size, 'below', 0)).toEqual({ x: 100, y: 350, ...size });
    });

    test('a side an agent gave goes up to the grid and is nothing outside what a frame drags to', () => {
        expect(gridSide(500, NODE_SIZE_MIN.w)).toBe(504);
        expect(gridSide(NODE_SIZE_MIN.w, NODE_SIZE_MIN.w)).toBe(NODE_SIZE_MIN.w);
        expect(gridSide(NODE_SIZE_MIN.w - CANVAS_GRID, NODE_SIZE_MIN.w)).toBeNull();
        expect(gridSide(NODE_SIZE_MAX + 1, NODE_SIZE_MIN.w)).toBeNull();
        expect([gridPoint(1003), gridPoint(-3), gridPoint(-2000)]).toEqual([1000, 0, -2000]);
    });
});

describe('arranging with a gap and an alignment', () => {
    const rects = [
        { x: 0, y: 0, w: 200, h: 100 },
        { x: 900, y: 900, w: 100, h: 300 }
    ];

    test('the gap is the room between two nodes, in a row and in a column', () => {
        expect(arrangeRects(rects, 'row', undefined, { gap: 80 }).map((rect) => rect.x)).toEqual([0, 280]);
        expect(arrangeRects(rects, 'column', undefined, { gap: 0 }).map((rect) => rect.y)).toEqual([0, 100]);
    });

    test('a node stands at the start, the middle or the end of the cell its row and column give it', () => {
        expect(arrangeRects(rects, 'row', undefined, { align: 'center' }).map((rect) => rect.y)).toEqual([100, 0]);
        expect(arrangeRects(rects, 'row', undefined, { align: 'end' }).map((rect) => rect.y)).toEqual([200, 0]);
        expect(arrangeRects(rects, 'column', undefined, { align: 'end' }).map((rect) => rect.x)).toEqual([0, 100]);
    });
});

describe('spreading frames apart', () => {
    test('frames that stand too close move right or down by the smaller move, and the leftmost stays put', () => {
        const spread = spreadRects([
            { x: 0, y: 0, w: 200, h: 100 },
            { x: 150, y: 10, w: 200, h: 100 },
            { x: 20, y: 90, w: 200, h: 100 }
        ]);

        // From the left: the third goes down under the first, then the second goes right of both.
        expect(spread).toEqual([
            { x: 0, y: 0, w: 200, h: 100 },
            { x: 20 + 200 + PLACEMENT_GAP, y: 10, w: 200, h: 100 },
            { x: 20, y: 100 + PLACEMENT_GAP, w: 200, h: 100 }
        ]);
    });

    test('frames with room between them stay where they are, and no gap only undoes an overlap', () => {
        const apart = [
            { x: 0, y: 0, w: 200, h: 100 },
            { x: 240, y: 0, w: 200, h: 100 }
        ];
        const touching = [
            { x: 0, y: 0, w: 200, h: 100 },
            { x: 210, y: 0, w: 200, h: 100 }
        ];

        expect(spreadRects(apart)).toEqual(apart);
        expect(spreadRects(touching, 0)).toEqual(touching);
        expect(spreadRects(touching)[1]).toEqual({ x: 240, y: 0, w: 200, h: 100 });
    });
});
