import { describe, expect, test } from 'bun:test';
import { CSS_PIXELS_PER_POINT, PDF_PAGE_GAP, pdfPageBox, pdfPageScale, pdfPageTops, pdfReadingPage } from './pdf-layout';

const A4 = { width: 595, height: 842 };

describe('pdfPageScale', () => {
    test('actual size is 96 pixels to the inch, whatever the room', () => {
        expect(pdfPageScale('full', A4, 200)).toBe(CSS_PIXELS_PER_POINT);
    });

    test('fit shrinks a page to the width there is', () => {
        expect(pdfPageScale('fit', A4, 400)).toBeCloseTo(400 / 595);
    });

    test('fit never draws a page larger than its actual size', () => {
        expect(pdfPageScale('fit', A4, 4000)).toBe(CSS_PIXELS_PER_POINT);
    });

    test('before the room is measured a page is drawn at its actual size', () => {
        expect(pdfPageScale('fit', A4, 0)).toBe(CSS_PIXELS_PER_POINT);
    });
});

test('a page box is whole pixels', () => {
    expect(pdfPageBox(A4, 400 / 595)).toEqual({ width: 400, height: 566 });
});

test('pages stack with a gap above each', () => {
    expect(pdfPageTops([100, 200, 50])).toEqual([PDF_PAGE_GAP, 100 + 2 * PDF_PAGE_GAP, 300 + 3 * PDF_PAGE_GAP]);
});

describe('pdfReadingPage', () => {
    const tops = pdfPageTops([1000, 1000, 1000, 200]);

    test('the first page at the top', () => {
        expect(pdfReadingPage(tops, { top: 0, height: 900, scrollHeight: 3300 })).toBe(1);
    });

    test('a page counts once its top passed a third of the view', () => {
        expect(pdfReadingPage(tops, { top: 800, height: 900, scrollHeight: 3300 })).toBe(2);
        expect(pdfReadingPage(tops, { top: 600, height: 900, scrollHeight: 3300 })).toBe(1);
    });

    test('the bottom of the stack is the last page, however short', () => {
        expect(pdfReadingPage(tops, { top: 2400, height: 900, scrollHeight: 3300 })).toBe(4);
    });

    test('no pages is page 0', () => {
        expect(pdfReadingPage([], { top: 0, height: 900, scrollHeight: 900 })).toBe(0);
    });
});
