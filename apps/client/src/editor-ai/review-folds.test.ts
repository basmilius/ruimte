import { describe, expect, test } from 'bun:test';
import { REVIEW_CONTEXT, unchangedFolds } from './review-folds';

describe('the folds of a file under review', () => {
    test('hide the stretches between changes and keep three lines of context beside each change', () => {
        // A 60 line file with changes on lines 11 and 40 (one-based).
        const folds = unchangedFolds(
            [
                { startLine: 11, endLine: 11 },
                { startLine: 40, endLine: 42 }
            ],
            60
        );

        expect(REVIEW_CONTEXT).toBe(3);
        // Lines 1-7 above the first change hide behind line 1, 15-36 hide behind line 14, 46-60 hide behind line 45 (zero-based below).
        expect(folds.custom).toEqual([
            { startLine: 0, endLine: 6 },
            { startLine: 13, endLine: 35 },
            { startLine: 44, endLine: 59 }
        ]);
        expect(folds.collapsed).toEqual(folds.custom);
    });

    test('leave a stretch that is too short to be worth a chip', () => {
        expect(unchangedFolds([{ startLine: 5, endLine: 5 }], 10)).toEqual({ collapsed: [], custom: [] });
        expect(
            unchangedFolds(
                [
                    { startLine: 1, endLine: 1 },
                    { startLine: 12, endLine: 12 }
                ],
                15
            ).custom
        ).toEqual([{ startLine: 3, endLine: 7 }]);
    });

    test('keep the line a removal stood in front of, and the last line for a removal at the end', () => {
        const removal = unchangedFolds([{ startLine: 20, endLine: 19 }], 30);

        expect(removal.custom).toEqual([
            { startLine: 0, endLine: 15 },
            { startLine: 22, endLine: 29 }
        ]);
        expect(unchangedFolds([{ startLine: 31, endLine: 30 }], 30).custom).toEqual([{ startLine: 0, endLine: 25 }]);
    });

    test('fold nothing without a change or a line', () => {
        expect(unchangedFolds([], 40)).toEqual({ collapsed: [], custom: [] });
        expect(unchangedFolds([{ startLine: 1, endLine: 1 }], 0)).toEqual({ collapsed: [], custom: [] });
    });
});
