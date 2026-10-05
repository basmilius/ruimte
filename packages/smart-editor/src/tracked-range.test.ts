import { describe, expect, test } from 'bun:test';
import { mapTrackedRange } from './tracked-range.ts';

const change = (from: number, to: number, insertedLength: number) => ({ from, to, insertedLength });

describe('mapTrackedRange', () => {
    test('moves with an edit before it and ignores one after it', () => {
        expect(mapTrackedRange(10, 20, [change(0, 0, 3)])).toEqual({ from: 13, to: 23 });
        expect(mapTrackedRange(10, 20, [change(2, 5, 0)])).toEqual({ from: 7, to: 17 });
        expect(mapTrackedRange(10, 20, [change(25, 30, 1)])).toEqual({ from: 10, to: 20 });
    });

    test('is lost to an edit inside it or across either end', () => {
        expect(mapTrackedRange(10, 20, [change(12, 14, 2)])).toBeNull();
        expect(mapTrackedRange(10, 20, [change(15, 15, 1)])).toBeNull();
        expect(mapTrackedRange(10, 20, [change(8, 12, 0)])).toBeNull();
        expect(mapTrackedRange(10, 20, [change(18, 22, 4)])).toBeNull();
        expect(mapTrackedRange(10, 20, [change(10, 20, 10)])).toBeNull();
    });

    test('survives text inserted at its ends and edits that only touch them', () => {
        expect(mapTrackedRange(10, 20, [change(10, 10, 4)])).toEqual({ from: 14, to: 24 });
        expect(mapTrackedRange(10, 20, [change(20, 20, 4)])).toEqual({ from: 10, to: 20 });
        expect(mapTrackedRange(10, 20, [change(5, 10, 0)])).toEqual({ from: 5, to: 15 });
        expect(mapTrackedRange(10, 20, [change(20, 25, 0)])).toEqual({ from: 10, to: 20 });
    });

    test('adds up the changes of a batch that lie before it, and stops at one inside', () => {
        expect(mapTrackedRange(10, 20, [change(0, 0, 2), change(4, 6, 0), change(30, 30, 9)])).toEqual({ from: 10, to: 20 });
        expect(mapTrackedRange(10, 20, [change(0, 0, 2), change(15, 16, 1)])).toBeNull();
    });

    test('keeps an empty range behind text inserted at it', () => {
        expect(mapTrackedRange(5, 5, [change(5, 5, 3)])).toEqual({ from: 8, to: 8 });
        expect(mapTrackedRange(5, 5, [change(3, 8, 0)])).toBeNull();
    });
});
