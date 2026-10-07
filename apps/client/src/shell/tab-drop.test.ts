import { describe, expect, test } from 'bun:test';
import {
    clampTabLeft,
    DROP_STROKE,
    dropPreviewPath,
    gapAt,
    gapLeft,
    positionAfterLifting,
    rectPreview,
    sameDropPreview,
    tabPreview,
    wantsNewTab
} from './tab-drop';

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

describe('dropPreviewPath', () => {
    const tab = { x: 0, y: 0, width: 400, height: 300, barHeight: 40, tabLeft: 100, tabWidth: 128, tabTop: 4, radius: 6 };

    /* The letters of the commands and every number in the path, which is all a transition has to line up. */
    const commands = (path: string): string => path.replace(/[0-9.-]+/g, '').replace(/[ ,]+/g, ' ');
    const numbers = (path: string): number[] => (path.match(/-?[0-9]+(\.[0-9]+)?/g) ?? []).map(Number);

    test('draws the tab and the body as one closed outline', () => {
        expect(dropPreviewPath(tab, 0)).toBe(
            'M4,40 H100 V10 A6,6 0 0 1 106,4 H222 A6,6 0 0 1 228,10 V40 H396 A4,4 0 0 1 400,44 V296 A4,4 0 0 1 396,300 H4 A4,4 0 0 1 0,296 V44 A4,4 0 0 1 4,40 Z'
        );
    });

    test('runs inside the box by half the stroke unless told otherwise, with the corners shrunk to match', () => {
        expect(dropPreviewPath(tab)).toBe(dropPreviewPath(tab, DROP_STROKE / 2));
        expect(dropPreviewPath(tab, 1)).toBe(
            'M4,41 H101 V10 A5,5 0 0 1 106,5 H222 A5,5 0 0 1 227,10 V41 H396 A3,3 0 0 1 399,44 V296 A3,3 0 0 1 396,299 H4 A3,3 0 0 1 1,296 V44 A3,3 0 0 1 4,41 Z'
        );
    });

    test('is the same outline moved when the box stands elsewhere in the grid', () => {
        const moved = { ...tab, x: 30, y: 20, tabLeft: 130, tabTop: 24 };
        expect(dropPreviewPath(moved, 0)).toBe(
            'M34,60 H130 V30 A6,6 0 0 1 136,24 H252 A6,6 0 0 1 258,30 V60 H426 A4,4 0 0 1 430,64 V316 A4,4 0 0 1 426,320 H34 A4,4 0 0 1 30,316 V64 A4,4 0 0 1 34,60 Z'
        );
    });

    test('continues the side of the box when the tab is flush with it', () => {
        expect(dropPreviewPath({ ...tab, tabLeft: 0 }, 0)).toBe(
            'M0,40 H0 V10 A6,6 0 0 1 6,4 H122 A6,6 0 0 1 128,10 V40 H396 A4,4 0 0 1 400,44 V296 A4,4 0 0 1 396,300 H4 A4,4 0 0 1 0,296 V40 A0,0 0 0 1 0,40 Z'
        );
        expect(dropPreviewPath({ ...tab, tabLeft: 272 }, 0)).toBe(
            'M4,40 H272 V10 A6,6 0 0 1 278,4 H394 A6,6 0 0 1 400,10 V40 H400 A0,0 0 0 1 400,40 V296 A4,4 0 0 1 396,300 H4 A4,4 0 0 1 0,296 V44 A4,4 0 0 1 4,40 Z'
        );
    });

    test('cuts a tab placed past an end off at the box instead of drawing outside it', () => {
        expect(dropPreviewPath({ ...tab, tabLeft: 380 })).toBe(dropPreviewPath({ ...tab, tabLeft: 380, tabWidth: 20 }));
        expect(dropPreviewPath({ ...tab, tabLeft: -30 })).toBe(dropPreviewPath({ ...tab, tabLeft: 0, tabWidth: 98 }));
    });

    test('keeps a tab that is too wide for the radius round at half its width and no further', () => {
        expect(dropPreviewPath({ ...tab, tabWidth: 8 }, 0)).toContain('A4,4 0 0 1 104,4');
    });

    describe('a rectangle', () => {
        const rect = rectPreview({ x: 10, y: 20, width: 200, height: 100 });

        test('is a tab with no height, so it is the same outline with a flat top', () => {
            expect(dropPreviewPath(rect, 0)).toBe(
                'M14,20 H14 V20 A0,0 0 0 1 14,20 H14 A0,0 0 0 1 14,20 V20 H206 A4,4 0 0 1 210,24 V116 A4,4 0 0 1 206,120 H14 A4,4 0 0 1 10,116 V24 A4,4 0 0 1 14,20 Z'
            );
        });

        test('has its outer edge on the box, with the corners of a body', () => {
            expect(dropPreviewPath(rect)).toBe(
                'M14,21 H15 V21 A0,0 0 0 1 15,21 H15 A0,0 0 0 1 15,21 V21 H206 A3,3 0 0 1 209,24 V116 A3,3 0 0 1 206,119 H14 A3,3 0 0 1 11,116 V24 A3,3 0 0 1 14,21 Z'
            );
        });

        test('spans a column as wide and as tall as the grid gives it', () => {
            const column = rectPreview({ x: 0, y: 0, width: 600, height: 900 });
            expect(dropPreviewPath(column, 0)).toContain('V896 A4,4 0 0 1 596,900');
            expect(dropPreviewPath(column, 0)).toContain('H596 A4,4 0 0 1 600,4');
        });
    });

    test('has the same commands and as many numbers for a rectangle, a tab and a tab flush with a side', () => {
        const shapes = [
            rectPreview({ x: 0, y: 0, width: 300, height: 200 }),
            rectPreview({ x: 150, y: 40, width: 20, height: 12 }),
            tab,
            { ...tab, tabLeft: 0 },
            { ...tab, tabLeft: 272 },
            { ...tab, tabLeft: 380 },
            tabPreview({ gap: 1, left: 50, tabWidth: 96, width: 500, height: 400, barHeight: 36 }, { x: 240, y: 12 })
        ];
        const reference = dropPreviewPath(shapes[0]!);
        for (const shape of shapes) {
            for (const inset of [0, 1]) {
                const path = dropPreviewPath(shape, inset);
                expect(commands(path)).toBe(commands(reference));
                expect(numbers(path)).toHaveLength(numbers(reference).length);
            }
        }
    });
});

describe('tabPreview', () => {
    test('puts the tab of a cell at its place in the grid', () => {
        const drop = { gap: 2, left: 60, tabWidth: 100, width: 480, height: 320, barHeight: 36 };
        expect(tabPreview(drop, { x: 200, y: 8 })).toEqual({
            x: 200,
            y: 8,
            width: 480,
            height: 320,
            barHeight: 36,
            tabLeft: 260,
            tabWidth: 100,
            tabTop: 12,
            radius: 6
        });
    });
});

describe('sameDropPreview', () => {
    test('is true for equal shapes and for two missing ones only', () => {
        const rect = rectPreview({ x: 1, y: 2, width: 3, height: 4 });
        expect(sameDropPreview(rect, { ...rect })).toBe(true);
        expect(sameDropPreview(rect, { ...rect, width: 5 })).toBe(false);
        expect(sameDropPreview(rect, null)).toBe(false);
        expect(sameDropPreview(null, null)).toBe(true);
    });
});
