import { describe, expect, test } from 'bun:test';
import { disjointRects, pageClipPath } from '@/browser/page-clip';

describe('disjointRects', () => {
    test('keeps one rectangle whole', () => {
        expect(disjointRects([{ x: 10, y: 10, w: 40, h: 20 }])).toEqual([{ x: 10, y: 10, w: 40, h: 20 }]);
    });

    test('keeps two that stand apart', () => {
        const rects = [
            { x: 0, y: 0, w: 10, h: 10 },
            { x: 50, y: 50, w: 10, h: 10 }
        ];
        expect(disjointRects(rects)).toEqual(rects);
    });

    test('cuts two that cross into pieces that do not', () => {
        const pieces = disjointRects([
            { x: 0, y: 0, w: 20, h: 20 },
            { x: 10, y: 10, w: 20, h: 20 }
        ]);
        const area = pieces.reduce((total, piece) => total + piece.w * piece.h, 0);
        // Two squares of 400 sharing a corner of 100.
        expect(area).toBe(700);
        for (const [index, piece] of pieces.entries()) {
            for (const other of pieces.slice(index + 1)) {
                const overlaps = piece.x < other.x + other.w && other.x < piece.x + piece.w && piece.y < other.y + other.h && other.y < piece.y + piece.h;
                expect(overlaps).toBe(false);
            }
        }
    });
});

describe('pageClipPath', () => {
    test('is nothing without a hole', () => {
        expect(pageClipPath(100, 100, [])).toBeNull();
    });

    test('is nothing for a hole beside the page', () => {
        expect(pageClipPath(100, 100, [{ x: 200, y: 0, w: 50, h: 50, radius: 12 }])).toBeNull();
    });

    test('rounds every corner of a hole that fits on the page', () => {
        const path = pageClipPath(200, 200, [{ x: 50, y: 50, w: 100, h: 100, radius: 12 }]);
        expect(path).toBe(
            'path(evenodd, "M0,0 H200 V200 H0 Z M62,50 H138 A12,12 0 0 1 150,62 V138 A12,12 0 0 1 138,150 H62 A12,12 0 0 1 50,138 V62 A12,12 0 0 1 62,50 Z")'
        );
    });

    test('squares off the corners the page edge already cuts', () => {
        const path = pageClipPath(100, 100, [{ x: -20, y: 10, w: 60, h: 20, radius: 12 }]);
        // The two left corners are the page's own edge; the right ones keep the node's rounding.
        expect(path).toBe('path(evenodd, "M0,0 H100 V100 H0 Z M0,10 H30 A10,10 0 0 1 40,20 V20 A10,10 0 0 1 30,30 H0 V10 Z")');
    });

    test('never rounds more than half the hole', () => {
        const path = pageClipPath(100, 100, [{ x: 10, y: 10, w: 10, h: 10, radius: 12 }]);
        expect(path).toContain('A5,5');
    });

    test('cuts two holes that cross along each other, losing their corners', () => {
        const path = pageClipPath(200, 200, [
            { x: 0, y: 0, w: 100, h: 100, radius: 12 },
            { x: 50, y: 50, w: 100, h: 100, radius: 12 }
        ])!;
        expect(path).not.toContain('A');
        // Nothing may be cut twice, or even-odd fills the piece the two share.
        expect(path.split('M').length - 1).toBeGreaterThan(2);
    });
});
