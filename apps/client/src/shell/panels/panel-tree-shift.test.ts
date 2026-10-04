import { describe, expect, test } from 'bun:test';
import { clampShift, maxShift, shiftNeed, shiftThumb, sidewaysDelta, type WheelStep } from './panel-tree-shift.ts';

function step(extra: Partial<WheelStep>): WheelStep {
    return { deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ...extra };
}

describe('the shift of a panel tree', () => {
    test('stays between nothing and what the widest row needs', () => {
        expect(clampShift(-12, 40)).toBe(0);
        expect(clampShift(25.5, 40)).toBe(25.5);
        expect(clampShift(64, 40)).toBe(40);
        expect(clampShift(10, 0)).toBe(0);
    });

    test('a row asks for what its name runs past its limit, wherever it was measured', () => {
        expect(shiftNeed(260, 200, 0)).toBe(60);
        expect(shiftNeed(230, 200, 30)).toBe(60);
        expect(shiftNeed(200.2, 200, 0)).toBe(1);
    });

    test('a row whose name fits asks for nothing', () => {
        expect(shiftNeed(150, 200, 0)).toBe(0);
        expect(shiftNeed(150, 200, 30)).toBe(0);
    });

    test('the widest row decides, and no rows ask for nothing', () => {
        expect(maxShift([0, 60, 12])).toBe(60);
        expect(maxShift([])).toBe(0);
    });
});

describe('the sideways part of a wheel step', () => {
    test('a swipe sideways moves the rows', () => {
        expect(sidewaysDelta(step({ deltaX: 12 }), 300)).toBe(12);
        expect(sidewaysDelta(step({ deltaX: -8, deltaY: 2 }), 300)).toBe(-8);
    });

    test('a scroll that is mostly up or down is left to the tree', () => {
        expect(sidewaysDelta(step({ deltaY: 40 }), 300)).toBe(0);
        expect(sidewaysDelta(step({ deltaX: 3, deltaY: 20 }), 300)).toBe(0);
        expect(sidewaysDelta(step({ deltaX: 5, deltaY: -5 }), 300)).toBe(0);
    });

    test('Shift turns a wheel without a horizontal axis sideways', () => {
        expect(sidewaysDelta(step({ deltaY: 30, shiftKey: true }), 300)).toBe(30);
        expect(sidewaysDelta(step({ deltaX: 30, shiftKey: true }), 300)).toBe(30);
    });

    test('steps in lines and pages are counted in pixels', () => {
        expect(sidewaysDelta(step({ deltaX: 2, deltaMode: 1 }), 300)).toBe(32);
        expect(sidewaysDelta(step({ deltaX: 1, deltaMode: 2 }), 300)).toBe(300);
    });
});

describe('the thumb of the indicator', () => {
    test('is as wide as the share of the content the rows show', () => {
        expect(shiftThumb(0, 100, 200, 300)).toEqual({ left: 0, width: 150 });
    });

    test('travels the track as the rows slide', () => {
        expect(shiftThumb(50, 100, 200, 300)).toEqual({ left: 25, width: 150 });
        expect(shiftThumb(100, 100, 200, 300)).toEqual({ left: 50, width: 150 });
    });

    test('stays large enough to see', () => {
        expect(shiftThumb(0, 10_000, 200, 300).width).toBe(24);
    });

    test('fills the track when there is nothing to slide', () => {
        expect(shiftThumb(0, 0, 200, 300)).toEqual({ left: 0, width: 200 });
    });
});
