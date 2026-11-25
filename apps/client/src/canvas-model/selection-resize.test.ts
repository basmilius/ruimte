import { describe, expect, test } from 'bun:test';
import type { Rect } from '@/canvas-model/math';
import { resizedSelection } from './selection-resize';

function rect(x: number, y: number, w = 200, h = 100): Rect {
    return { x, y, w, h };
}

/* Every frame of `before` at one size, as dragging the handle of `draggedId` to `dragged` leaves them. */
function atOneSize(before: Record<string, Rect>, draggedId: string, dragged: Rect): Record<string, Rect> {
    const sizes = Object.fromEntries(Object.keys(before).map((id) => [id, { w: dragged.w, h: dragged.h }]));

    return resizedSelection(before, sizes, draggedId, dragged);
}

describe('a selection resized by one handle', () => {
    test('a row keeps the room between its frames', () => {
        const row = { a: rect(0, 0), b: rect(240, 0), c: rect(480, 0) };

        expect(atOneSize(row, 'a', rect(0, 0, 300, 100))).toEqual({ a: rect(0, 0, 300, 100), b: rect(340, 0, 300, 100), c: rect(680, 0, 300, 100) });
    });

    test('a grid keeps its rows and its columns', () => {
        const grid = { a: rect(0, 0), b: rect(240, 0), c: rect(480, 0), d: rect(0, 140), e: rect(240, 140), f: rect(480, 140) };
        const resized = atOneSize(grid, 'a', rect(0, 0, 300, 150));

        expect(Object.values(resized).map((frame) => [frame.x, frame.y])).toEqual([
            [0, 0],
            [340, 0],
            [680, 0],
            [0, 190],
            [340, 190],
            [680, 190]
        ]);
    });

    test('frames of different sizes end at one size, each as far from its neighbor as it was', () => {
        const row = { a: rect(0, 0, 200, 100), b: rect(240, 0, 400, 100), c: rect(680, 0, 100, 100) };

        // b grows away from a and shrinks toward c, so c stays where it stood.
        expect(atOneSize(row, 'a', rect(0, 0, 300, 100))).toEqual({ a: rect(0, 0, 300, 100), b: rect(340, 0, 300, 100), c: rect(680, 0, 300, 100) });
    });

    test('shrinking closes a row up by what its frames lost', () => {
        const row = { a: rect(0, 0, 400, 100), b: rect(440, 0, 400, 100) };

        expect(atOneSize(row, 'a', rect(0, 0, 240, 100)).b).toEqual(rect(280, 0, 240, 100));
    });

    test('the dragged frame lands where its handle put it, whichever frame of the row it is', () => {
        const row = { a: rect(0, 0), b: rect(240, 0), c: rect(480, 0) };
        // The west handle of the middle frame, pulled 100 to the left: its right edge stays at 440.
        const resized = atOneSize(row, 'b', rect(140, 0, 300, 100));

        expect(resized.b).toEqual(rect(140, 0, 300, 100));
        expect([resized.a!.x, resized.c!.x]).toEqual([-200, 480]);
    });

    test('a frame takes only the side it is given, and one on its own comes back as the handle left it', () => {
        const row = { a: rect(0, 0), folded: rect(240, 0, 200, 40) };
        const resized = resizedSelection(row, { a: { w: 300, h: 200 }, folded: { w: 300, h: 40 } }, 'a', rect(0, 0, 300, 200));

        expect(resized.folded).toEqual(rect(340, 0, 300, 40));
        expect(atOneSize({ a: rect(8, 16) }, 'a', rect(0, 16, 304, 152))).toEqual({ a: rect(0, 16, 304, 152) });
    });
});
