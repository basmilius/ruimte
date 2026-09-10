import { describe, expect, test } from 'bun:test';
import type { DrawingElement } from '@ruimte/contracts';
import { arrowHead, boundsOfElements, elementAt, elementsIn, hitsElement, rectFromPoints, resizeRect, rotatePoint, scaleElement } from './geometry.ts';

const base = { stroke: 'ink', strokeWidth: 2, seed: 1 } as const;

const rect = (id: string, x = 0, y = 0, w = 100, h = 60): DrawingElement => ({ kind: 'rect', id, x, y, w, h, ...base });

const ellipse = (id: string): DrawingElement => ({ kind: 'ellipse', id, x: 0, y: 0, w: 100, h: 100, ...base });

const line = (id: string): DrawingElement => ({
    kind: 'line',
    id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...base,
    points: [
        [0, 0],
        [100, 100]
    ]
});

describe('hit tests', () => {
    test('an empty shape is hit on its outline, not in the middle', () => {
        expect(hitsElement(rect('a'), { x: 0, y: 30 }, 4)).toBe(true);
        expect(hitsElement(rect('a'), { x: 50, y: 30 }, 4)).toBe(false);
    });

    test('a filled shape is hit anywhere inside it', () => {
        expect(hitsElement({ ...rect('a'), fill: 'solid', fillColor: 'blue' }, { x: 50, y: 30 }, 4)).toBe(true);
    });

    test('an ellipse is hit on its curve', () => {
        expect(hitsElement(ellipse('a'), { x: 50, y: 0 }, 4)).toBe(true);
        expect(hitsElement(ellipse('a'), { x: 4, y: 4 }, 4)).toBe(false);
    });

    test('a line is hit along the segment and nowhere else', () => {
        expect(hitsElement(line('a'), { x: 50, y: 50 }, 4)).toBe(true);
        expect(hitsElement(line('a'), { x: 50, y: 80 }, 4)).toBe(false);
    });

    test('a turned element is hit where it is drawn, not where its box says', () => {
        const turned: DrawingElement = { ...rect('a'), angle: Math.PI / 2 };
        // A quarter turn puts the left edge at the top of the box.
        expect(hitsElement(turned, { x: 50, y: 30 }, 4)).toBe(false);
        expect(hitsElement(turned, { x: 50, y: -20 }, 4)).toBe(true);
    });

    test('the top-most element wins and a locked one is not there at all', () => {
        const elements = [rect('under'), { ...rect('over'), fill: 'solid' as const }];
        expect(elementAt(elements, { x: 50, y: 30 }, 4)?.id).toBe('over');
        expect(elementAt([{ ...rect('locked'), fill: 'solid' as const, locked: true }], { x: 50, y: 30 }, 4)).toBeUndefined();
    });

    test('a marquee takes what it touches, never a locked element', () => {
        const elements = [rect('a'), rect('b', 400), { ...rect('c', 10), locked: true }];
        expect(elementsIn(elements, { x: -10, y: -10, w: 200, h: 200 }).map((element) => element.id)).toEqual(['a']);
    });
});

describe('boxes', () => {
    test('a drag in any direction makes a box with positive sides', () => {
        expect(rectFromPoints({ x: 100, y: 80 }, { x: 20, y: 20 })).toEqual({ x: 20, y: 20, w: 80, h: 60 });
    });

    test('the bounds of a drawing hold everything in it', () => {
        expect(boundsOfElements([rect('a'), rect('b', 200, 100)])).toEqual({ x: 0, y: 0, w: 300, h: 160 });
        expect(boundsOfElements([])).toBeNull();
    });

    test('a resize moves the handle and leaves the opposite side where it was', () => {
        expect(resizeRect({ x: 0, y: 0, w: 100, h: 60 }, 'se', { x: 200, y: 100 })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
        expect(resizeRect({ x: 0, y: 0, w: 100, h: 60 }, 'nw', { x: -50, y: -30 })).toEqual({ x: -50, y: -30, w: 150, h: 90 });
    });

    test('keeping the proportions scales both sides by the same amount', () => {
        const resized = resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'se', { x: 200, y: 60 }, true);
        expect(resized.w / resized.h).toBeCloseTo(2, 5);
    });

    test('scaling a line takes its points along', () => {
        const scaled = scaleElement(line('a'), { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 100 });
        expect(scaled.kind === 'line' && scaled.points).toEqual([
            [0, 0],
            [200, 100]
        ]);
    });
});

describe('turning and arrows', () => {
    test('a point turns around the center it is given', () => {
        const turned = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
        expect(turned.x).toBeCloseTo(0, 5);
        expect(turned.y).toBeCloseTo(10, 5);
    });

    test('an arrow head is two lines back from the tip', () => {
        const head = arrowHead({ x: 100, y: 0 }, { x: 0, y: 0 }, 10);
        expect(head).toHaveLength(2);
        expect(head[0]![0]).toEqual({ x: 100, y: 0 });
        expect(head[0]![1]!.x).toBeLessThan(100);
    });
});
