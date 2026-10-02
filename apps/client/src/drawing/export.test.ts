import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DrawingElement } from '@ruimte/contracts';
import { CLIPBOARD_TYPE, drawingSvg, readDrawingElements } from './export';

describe('the clipboard', () => {
    test('elements of this app come back, anything else does not', () => {
        const elements = [{ kind: 'rect', id: 'el-1', x: 0, y: 0, w: 10, h: 10, stroke: 'ink', strokeWidth: 2, seed: 1 }];
        expect(readDrawingElements(JSON.stringify({ type: CLIPBOARD_TYPE, elements }))).toEqual(elements as never);
        expect(readDrawingElements(JSON.stringify({ type: 'text/plain', elements }))).toBeNull();
        expect(readDrawingElements('a line someone copied')).toBeNull();
    });
});

describe('the SVG of a drawing', () => {
    const scope = globalThis as Record<string, unknown>;

    /* A page whose every token resolves to its own name, so the SVG says which token it read. */
    beforeEach(() => {
        const probe = { style: { color: '' }, remove: () => {}, getContext: () => null };
        scope.document = { createElement: () => probe, body: { append: () => {} }, documentElement: {} };
        scope.getComputedStyle = (element: typeof probe) => ({ color: element.style?.color ?? '', getPropertyValue: () => '' });
    });

    afterEach(() => {
        delete scope.document;
        delete scope.getComputedStyle;
    });

    test('edges a note with the edge of its paper, as the PNG does', () => {
        const note: DrawingElement = {
            kind: 'note',
            id: 'n',
            x: 0,
            y: 0,
            w: 200,
            h: 120,
            stroke: 'yellow',
            strokeWidth: 1,
            seed: 1,
            text: 'buy milk',
            size: 20
        };
        const store = { getState: () => ({ exportBackground: false }) } as unknown as Parameters<typeof drawingSvg>[0];
        expect(drawingSvg(store, [note])).toContain('stroke="var(--draw-edge-yellow)"');
    });
});
