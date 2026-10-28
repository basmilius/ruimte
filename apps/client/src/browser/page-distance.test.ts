import { describe, expect, test } from 'bun:test';
import { belowSinceOf, FAR_AFTER_MS, pageFar, wakeAt, type PageDistance } from '@/browser/page-distance';

function page(input: Partial<PageDistance>): PageDistance {
    return {
        zoom: 0.3,
        distance: 'standard',
        maximized: false,
        onCanvas: true,
        active: false,
        gesturing: false,
        wasFar: false,
        belowSince: 0,
        now: FAR_AFTER_MS,
        ...input
    };
}

describe('a page past the render distance', () => {
    test('goes once the camera rested past the line, and not on the line itself', () => {
        expect(pageFar(page({}))).toBe(true);
        expect(pageFar(page({ zoom: 0.4 }))).toBe(false);
        expect(pageFar(page({ zoom: 0.3, distance: 'far' }))).toBe(false);
        expect(pageFar(page({ zoom: 0.1, distance: 'unlimited' }))).toBe(false);
    });

    test('waits out the pause before it goes, and never while a gesture runs', () => {
        expect(pageFar(page({ now: FAR_AFTER_MS - 1 }))).toBe(false);
        expect(pageFar(page({ belowSince: null }))).toBe(false);
        expect(pageFar(page({ gesturing: true }))).toBe(false);
    });

    test('that already went stays gone through a gesture, and comes back at once on the line', () => {
        expect(pageFar(page({ wasFar: true, gesturing: true, now: 1 }))).toBe(true);
        expect(pageFar(page({ wasFar: true, zoom: 0.4 }))).toBe(false);
    });

    test('stays live while maximized, as a view of its own, or while it has the keyboard', () => {
        expect(pageFar(page({ maximized: true }))).toBe(false);
        expect(pageFar(page({ onCanvas: false }))).toBe(false);
        expect(pageFar(page({ active: true, wasFar: true }))).toBe(false);
    });

    test('the page that had the keyboard goes after the pause once another node takes it', () => {
        const start = 1000;
        expect(pageFar(page({ active: true, belowSince: 0, now: start }))).toBe(false);
        // The camera has been past the line all along, so the pause is already over when the keyboard moves.
        expect(pageFar(page({ active: false, belowSince: 0, now: start }))).toBe(true);
    });
});

describe('the moment the camera went past the line', () => {
    test('is kept while it stays past it and cleared once it is back', () => {
        expect(belowSinceOf(null, true, 5)).toBe(5);
        expect(belowSinceOf(5, true, 9)).toBe(5);
        expect(belowSinceOf(5, false, 9)).toBeNull();
    });
});

describe('the moment the layer looks again', () => {
    test('is the end of the pause while it runs, and never once it is over', () => {
        expect(wakeAt(null, 0)).toBeNull();
        expect(wakeAt(100, 200)).toBe(100 + FAR_AFTER_MS);
        // A page that stays past the line after the pause (it has the keyboard) waits for the canvas, not a timer.
        expect(wakeAt(100, 100 + FAR_AFTER_MS)).toBeNull();
        expect(wakeAt(100, 5000)).toBeNull();
    });
});
