import { describe, expect, test } from 'bun:test';
import { gapAt, positionAfterLifting, wantsNewTab } from './tab-drop';

const rects = [
    { left: 0, right: 100 },
    { left: 100, right: 180 },
    { left: 180, right: 300 }
];

describe('gapAt', () => {
    test('is the gap on the near side of the tab the pointer is over', () => {
        expect(gapAt(rects, 10)).toBe(0);
        expect(gapAt(rects, 60)).toBe(1);
        expect(gapAt(rects, 120)).toBe(1);
        expect(gapAt(rects, 150)).toBe(2);
        expect(gapAt(rects, 200)).toBe(2);
        expect(gapAt(rects, 250)).toBe(3);
    });

    test('is the first gap left of the strip, the last right of it, and 0 for no tabs', () => {
        expect(gapAt(rects, -50)).toBe(0);
        expect(gapAt(rects, 900)).toBe(3);
        expect(gapAt([], 40)).toBe(0);
    });
});

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
