import { describe, expect, test } from 'bun:test';
import { GHOST_AREA, ghostScale } from './empty-canvas';

describe('the ghosts of an empty canvas', () => {
    test('stand at their own size in a cell with room for them', () => {
        expect(ghostScale({ w: 1600, h: 900 })).toBe(1);
    });

    test('shrink to fit a small cell, by its tighter side, keeping room for the hint and the dock', () => {
        expect(ghostScale({ w: GHOST_AREA.w / 2 + 48, h: 900 })).toBe(0.5);
        expect(ghostScale({ w: 1600, h: GHOST_AREA.h / 4 + 200 })).toBe(0.25);
    });

    test('stand at their own size until the cell is measured', () => {
        expect(ghostScale({ w: 0, h: 0 })).toBe(1);
    });
});
