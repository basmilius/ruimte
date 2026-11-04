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
