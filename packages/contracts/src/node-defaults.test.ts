import { describe, expect, test } from 'bun:test';
import { CANVAS_GRID, GROUP_HEADER, GROUP_PADDING, groupFrame, groupMemberIds } from './node-defaults.ts';

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
});
