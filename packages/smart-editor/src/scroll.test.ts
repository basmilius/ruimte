import { describe, expect, test } from 'bun:test';
import { type ScrollKind, type ScrollRequest, scrollPosition } from './scroll.ts';

/* A view 400px tall over 20px lines, in a document of 1000 lines. */
function request(line: number, view: { x?: number; y: number }, extra: Partial<ScrollRequest> = {}): ScrollRequest {
    const y = line * 20;
    return {
        target: { x: 0, y },
        view: { x: view.x ?? 0, y: view.y, width: 800, height: 400 },
        content: { width: 2000, height: 1000 * 20 + 8 },
        lineHeight: 20,
        charWidth: 8,
        topBound: Math.max(0, y - 20),
        bottomBound: y + 40,
        refrain: false,
        horizontal: true,
        ...extra
    };
}

const at = (kind: ScrollKind, line: number, viewY: number, extra: Partial<ScrollRequest> = {}): number =>
    scrollPosition(request(line, { y: viewY }, extra), kind).y;

describe('keeping a target in view', () => {
    test('leaves it where it is while a line of margin is in view on both sides', () => {
        expect(at('relative', 10, 0)).toBe(0);
        expect(at('relative', 18, 0)).toBe(0);
    });

    test('scrolls the least that brings the line below the target into view', () => {
        expect(at('relative', 19, 0)).toBe(20);
        expect(at('relative', 22, 0)).toBe(80);
    });

    test('scrolls the least that brings the line above the target into view', () => {
        expect(at('relative', 20, 400)).toBe(380);
        expect(at('relative', 5, 400)).toBe(80);
    });

    test('centers when the margins do not fit in the view', () => {
        const narrow = { ...request(60, { y: 0 }), view: { x: 0, y: 0, width: 800, height: 30 } };
        expect(scrollPosition(narrow, 'relative').y).toBe(1195);
    });

    test('never scrolls past either end', () => {
        expect(at('relative', 0, 300)).toBe(0);
        expect(at('center', 999, 0)).toBe(1000 * 20 + 8 - 400);
    });
});

describe('jumping to a target', () => {
    test('puts a target out of view a third from the top', () => {
        expect(at('center', 100, 0)).toBe(2000 - 133);
        expect(at('makeVisible', 100, 0)).toBe(2000 - 133);
    });

    test('leaves a target in view alone when it only has to be made visible', () => {
        expect(at('makeVisible', 10, 0)).toBe(0);
        expect(at('makeVisible', 19, 0)).toBe(380 - 133);
    });

    test('centers always, unless asked to refrain from scrolling a target that is in view', () => {
        expect(at('center', 10, 0)).toBe(200 - 133);
        expect(at('center', 15, 0)).toBe(300 - 133);
        expect(at('center', 15, 0, { refrain: true })).toBe(0);
        expect(at('center', 100, 0, { refrain: true })).toBe(2000 - 133);
    });

    test('keeps going down or up the same way when it steps through results', () => {
        expect(at('centerDown', 15, 0)).toBe(300 - 133);
        expect(at('centerDown', 15, 200)).toBe(200);
        expect(at('centerUp', 15, 0)).toBe(0);
        expect(at('centerUp', 15, 200)).toBe(300 - 133);
    });
});

describe('sideways', () => {
    const side = (x: number, viewX: number, kind: ScrollKind = 'relative'): number =>
        scrollPosition({ ...request(0, { x: viewX, y: 0 }), target: { x, y: 0 } }, kind).x;

    test('keeps three characters in view next to the target', () => {
        expect(side(400, 0)).toBe(0);
        expect(side(790, 0)).toBe(790 + 24 - 800);
        expect(side(100, 400)).toBe(100 - 24);
    });

    test('goes back to the start when making visible what is near it', () => {
        expect(side(50, 400, 'makeVisible')).toBe(0);
    });

    test('is left alone in a wrapped view', () => {
        expect(scrollPosition({ ...request(0, { x: 0, y: 0 }), target: { x: 1500, y: 0 }, horizontal: false }, 'relative').x).toBe(0);
    });
});
