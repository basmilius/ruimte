import { describe, expect, test } from 'bun:test';
import { DEFAULT_STYLE } from '@/state/drawing';
import { constrainAngle, lineElement, settleStroke, shapeElement, shapeRect, snapPoint, textElement } from './gestures';

describe('drawing a shape', () => {
    test('a drag in any direction gives a box with positive sides', () => {
        expect(shapeRect({ x: 100, y: 100 }, { x: 40, y: 60 })).toEqual({ x: 40, y: 60, w: 60, h: 40 });
    });

    test('Shift makes it square and Alt grows it from where the drag started', () => {
        expect(shapeRect({ x: 0, y: 0 }, { x: 100, y: 40 }, { square: true })).toEqual({ x: 0, y: 0, w: 100, h: 100 });
        expect(shapeRect({ x: 0, y: 0 }, { x: 50, y: 30 }, { fromCenter: true })).toEqual({ x: -50, y: -30, w: 100, h: 60 });
    });

    test('the grid catches a point only when snapping is on', () => {
        expect(snapPoint({ x: 11, y: 20 }, true)).toEqual({ x: 8, y: 24 });
        expect(snapPoint({ x: 11, y: 20 }, false)).toEqual({ x: 11, y: 20 });
    });

    test('a shape carries the style that is up, and an unknown tool makes nothing', () => {
        const style = { ...DEFAULT_STYLE, stroke: 'red' as const, fill: 'hachure' as const };
        expect(shapeElement('diamond', { x: 0, y: 0, w: 10, h: 10 }, style, 'el-1', 3)).toMatchObject({
            kind: 'diamond',
            stroke: 'red',
            fill: 'hachure',
            seed: 3
        });
        expect(shapeElement('select', { x: 0, y: 0, w: 10, h: 10 }, style, 'el-1', 3)).toBeNull();
    });
});

describe('lines and text', () => {
    test('only the arrow tool puts a head on the line', () => {
        expect(lineElement('arrow', { x: 0, y: 0 }, { x: 10, y: 0 }, DEFAULT_STYLE, 'el-1', 1)).toMatchObject({ arrowEnd: true });
        expect(lineElement('line', { x: 0, y: 0 }, { x: 10, y: 0 }, DEFAULT_STYLE, 'el-1', 1)).not.toHaveProperty('arrowEnd');
    });

    test('Shift holds a line to whole steps of fifteen degrees', () => {
        const held = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
        expect(Math.atan2(held.y, held.x)).toBeCloseTo(0, 5);
    });

    test('a new text starts empty, in the style that is up', () => {
        expect(textElement({ x: 5, y: 6 }, { ...DEFAULT_STYLE, font: 'mono', textSize: 28 }, 'el-1', 1)).toMatchObject({
            kind: 'text',
            text: '',
            font: 'mono',
            size: 28,
            x: 5,
            y: 6
        });
    });
});

describe('settling a stroke', () => {
    test('the points move into the element and the box wraps them, rounded to a tenth', () => {
        const settled = settleStroke({
            kind: 'freehand',
            id: 'el-1',
            seed: 1,
            x: 100,
            y: 100,
            w: 0,
            h: 0,
            stroke: 'ink',
            strokeWidth: 2,
            points: [
                [0, 0],
                [-10.06, 20.04],
                [5, 40]
            ]
        });
        expect(settled).toMatchObject({ x: 89.94, y: 100 });
        expect(settled.kind === 'freehand' && settled.points).toEqual([
            [10.1, 0],
            [0, 20],
            [15.1, 40]
        ]);
        expect(settled.w).toBeCloseTo(15.06, 2);
        expect(settled.h).toBe(40);
    });
});
