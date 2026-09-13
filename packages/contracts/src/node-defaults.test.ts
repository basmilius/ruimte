import { describe, expect, test } from 'bun:test';
import { CANVAS_GRID, GROUP_HEADER, GROUP_PADDING, groupFrame } from './node-defaults.ts';

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
