// A PDF measures in points, 72 to the inch, and CSS draws 96 pixels to the inch.
export const CSS_PIXELS_PER_POINT = 96 / 72;

// Between two pages, and around the stack.
export const PDF_PAGE_GAP = 16;

export type PdfZoom = 'fit' | 'full';

/* A page at scale 1, in points, turned the way the document shows it. */
export interface PdfPageSize {
    width: number;
    height: number;
}

/* The scale a page is drawn at: its actual size, or smaller to fit the width there is, but never larger, the way `ImageFile` fits an image. */
export function pdfPageScale(zoom: PdfZoom, page: PdfPageSize, available: number): number {
    if (zoom === 'full' || available <= 0 || page.width <= 0) {
        return CSS_PIXELS_PER_POINT;
    }
    return Math.min(CSS_PIXELS_PER_POINT, available / page.width);
}

/* A page's box on screen in whole pixels, which is also the size its canvas is drawn at. */
export function pdfPageBox(page: PdfPageSize, scale: number): PdfPageSize {
    return {
        width: Math.floor(page.width * scale),
        height: Math.floor(page.height * scale)
    };
}

/* The top of every page in the stack, counted from the top of the stack. */
export function pdfPageTops(heights: readonly number[]): number[] {
    const tops: number[] = [];
    let top = PDF_PAGE_GAP;
    for (const height of heights) {
        tops.push(top);
        top += height + PDF_PAGE_GAP;
    }
    return tops;
}

/*
 * The page a person is reading, counted from 1: the last one whose top has passed a third of the
 * way down the view. A short last page never gets that far, so the bottom of the stack is the last page.
 */
export function pdfReadingPage(tops: readonly number[], scroll: { top: number; height: number; scrollHeight: number }): number {
    if (tops.length === 0) {
        return 0;
    }
    if (scroll.top + scroll.height >= scroll.scrollHeight - 1) {
        return tops.length;
    }
    const line = scroll.top + scroll.height / 3;
    let page = 1;
    for (let i = 1; i < tops.length && (tops[i] ?? Number.POSITIVE_INFINITY) <= line; i += 1) {
        page = i + 1;
    }
    return page;
}
