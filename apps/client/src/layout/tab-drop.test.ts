import { describe, expect, test } from 'bun:test';
import { clampTabLeft, gapLeft, positionAfterLifting, wantsNewTab } from './tab-drop';

const rects = [
    { left: 0, right: 100 },
    { left: 100, right: 180 },
    { left: 180, right: 300 }
];

describe('positionAfterLifting', () => {
    const ids = ['a', 'b', 'c'];

    test('shifts the gaps behind the dragged tab down by one', () => {
        expect(positionAfterLifting(ids, 0, 'b')).toBe(0);
        expect(positionAfterLifting(ids, 1, 'b')).toBe(1);
        expect(positionAfterLifting(ids, 2, 'b')).toBe(1);
        expect(positionAfterLifting(ids, 3, 'b')).toBe(2);
    });

    test('leaves the gaps alone for a tab from elsewhere', () => {
        expect(positionAfterLifting(ids, 2, 'x')).toBe(2);
        expect(positionAfterLifting(ids, 3, null)).toBe(3);
    });
});

describe('wantsNewTab', () => {
    test('is Cmd on macOS and Ctrl elsewhere', () => {
        expect(wantsNewTab({ metaKey: true, ctrlKey: false }, true)).toBe(true);
        expect(wantsNewTab({ metaKey: false, ctrlKey: true }, true)).toBe(false);
        expect(wantsNewTab({ metaKey: false, ctrlKey: true }, false)).toBe(true);
        expect(wantsNewTab({ metaKey: true, ctrlKey: false }, false)).toBe(false);
    });
});

describe('gapLeft', () => {
    test('is the left edge of the tab after the gap', () => {
        expect(gapLeft(rects, 0, 7)).toBe(0);
        expect(gapLeft(rects, 2, 7)).toBe(180);
    });

    test('is the right edge of the last tab for the gap after it', () => {
        expect(gapLeft(rects, 3, 7)).toBe(300);
    });

    test('is the fallback for a strip without tabs', () => {
        expect(gapLeft([], 0, 7)).toBe(7);
    });
});

describe('clampTabLeft', () => {
    const bounds = { left: 10, right: 400 };

    test('leaves a tab that fits where it is', () => {
        expect(clampTabLeft(100, 128, bounds)).toBe(100);
    });

    test('pulls a tab back inside either end', () => {
        expect(clampTabLeft(-20, 128, bounds)).toBe(10);
        expect(clampTabLeft(390, 128, bounds)).toBe(272);
    });

    test('puts a tab wider than the bounds at their left edge', () => {
        expect(clampTabLeft(50, 500, bounds)).toBe(10);
    });
});
