import { describe, expect, test } from 'bun:test';
import { clampTabLeft, gapAt, gapLeft, positionAfterLifting, tabDropPath, wantsNewTab } from './tab-drop';

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

describe('tabDropPath', () => {
    const shape = { width: 400, height: 300, barHeight: 40, tabLeft: 100, tabWidth: 128, tabTop: 4, radius: 6 };

    test('draws the tab and the body as one closed outline', () => {
        expect(tabDropPath(shape)).toBe(
            'M4,40 H100 V10 A6,6 0 0 1 106,4 H222 A6,6 0 0 1 228,10 V40 H396 A4,4 0 0 1 400,44 V296 A4,4 0 0 1 396,300 H4 A4,4 0 0 1 0,296 V44 A4,4 0 0 1 4,40 Z'
        );
    });

    test('runs inside the box by the inset, with the corners shrunk to match', () => {
        expect(tabDropPath({ ...shape, inset: 1 })).toBe(
            'M4,41 H101 V10 A5,5 0 0 1 106,5 H222 A5,5 0 0 1 227,10 V41 H396 A3,3 0 0 1 399,44 V296 A3,3 0 0 1 396,299 H4 A3,3 0 0 1 1,296 V44 A3,3 0 0 1 4,41 Z'
        );
    });

    test('continues the side of the cell when the tab is flush with it', () => {
        expect(tabDropPath({ ...shape, tabLeft: 0 })).toBe(
            'M0,40 H0 V10 A6,6 0 0 1 6,4 H122 A6,6 0 0 1 128,10 V40 H396 A4,4 0 0 1 400,44 V296 A4,4 0 0 1 396,300 H4 A4,4 0 0 1 0,296 V40 A0,0 0 0 1 0,40 Z'
        );
        expect(tabDropPath({ ...shape, tabLeft: 272 })).toBe(
            'M4,40 H272 V10 A6,6 0 0 1 278,4 H394 A6,6 0 0 1 400,10 V40 H400 A0,0 0 0 1 400,40 V296 A4,4 0 0 1 396,300 H4 A4,4 0 0 1 0,296 V44 A4,4 0 0 1 4,40 Z'
        );
    });

    test('cuts a tab placed past an end off at the cell instead of drawing outside it', () => {
        expect(tabDropPath({ ...shape, tabLeft: 380 })).toBe(tabDropPath({ ...shape, tabLeft: 380, tabWidth: 20 }));
        expect(tabDropPath({ ...shape, tabLeft: -30 })).toBe(tabDropPath({ ...shape, tabLeft: 0, tabWidth: 98 }));
    });

    test('keeps the same commands whatever the numbers, so a transition can move it', () => {
        const commands = (path: string): string => path.replace(/[0-9.,\- ]+/g, '|');
        expect(commands(tabDropPath(shape))).toBe(commands(tabDropPath({ ...shape, tabLeft: 0 })));
        expect(commands(tabDropPath(shape))).toBe(commands(tabDropPath({ ...shape, tabLeft: 380 })));
    });
});
