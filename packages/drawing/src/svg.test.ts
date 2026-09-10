import { describe, expect, test } from 'bun:test';
import type { DrawingColor, DrawingElement } from '@ruimte/contracts';
import { pathsOfElement } from './paths.ts';
import { toSvg } from './svg.ts';
import { readingOrder } from './reading-order.ts';

const palette = Object.fromEntries(
    (['ink', 'muted', 'accent', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as DrawingColor[]).map((name) => [name, `var(${name})`])
) as Record<DrawingColor, string>;

const base = { stroke: 'ink', strokeWidth: 2, seed: 7 } as const;

const rect = (id: string, x = 0, y = 0): DrawingElement => ({ kind: 'rect', id, x, y, w: 100, h: 60, ...base });

const text = (id: string, value: string, x: number, y: number): DrawingElement => ({
    kind: 'text',
    id,
    x,
    y,
    w: 80,
    h: 24,
    ...base,
    text: value,
    size: 20
});

const line = (id: string, from: [number, number], to: [number, number], head = true): DrawingElement => ({
    kind: 'line',
    id,
    x: from[0],
    y: from[1],
    w: Math.abs(to[0] - from[0]),
    h: Math.abs(to[1] - from[1]),
    ...base,
    points: [
        [0, 0],
        [to[0] - from[0], to[1] - from[1]]
    ],
    ...(head ? { arrowEnd: true } : {})
});

describe('paths', () => {
    test('the same seed draws the same path twice, and another seed does not', () => {
        expect(pathsOfElement(rect('a'))[0]!.d).toBe(pathsOfElement(rect('a'))[0]!.d);
        expect(pathsOfElement(rect('a'))[0]!.d).not.toBe(pathsOfElement({ ...rect('a'), seed: 8 })[0]!.d);
    });

    test('paths are drawn in the element frame, so moving it changes nothing about them', () => {
        expect(pathsOfElement(rect('a', 0, 0))[0]!.d).toBe(pathsOfElement(rect('a', 500, 300))[0]!.d);
    });

    test('a fill gives a path of its own, on top of the outline', () => {
        const paths = pathsOfElement({ ...rect('a'), fill: 'solid', fillColor: 'blue' });
        expect(paths.some((path) => path.role === 'fill')).toBe(true);
        expect(paths.some((path) => path.role === 'stroke')).toBe(true);
    });

    test('a dashed line says so on its stroke, and an arrow head is a path of its own', () => {
        const paths = pathsOfElement({ ...line('a', [0, 0], [100, 0]), strokeStyle: 'dashed' });
        expect(paths[0]!.dash).toEqual([8, 8]);
        expect(paths.at(-1)!.dash).toBeNull();
    });

    test('a stroke is one filled outline', () => {
        const paths = pathsOfElement({
            kind: 'freehand',
            id: 'f',
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            ...base,
            points: [
                [0, 0],
                [5, 5],
                [10, 10]
            ]
        });
        expect(paths).toHaveLength(1);
        expect(paths[0]!.role).toBe('ink');
        expect(paths[0]!.d.startsWith('M ')).toBe(true);
    });

    test('a text has no paths: the painter draws the glyphs', () => {
        expect(pathsOfElement(text('t', 'hello', 0, 0))).toEqual([]);
    });
});

const note = (id: string, value: string, x = 0, y = 0): DrawingElement => ({
    kind: 'note',
    id,
    x,
    y,
    w: 180,
    h: 180,
    ...base,
    fill: 'solid',
    fillColor: 'yellow',
    text: value,
    size: 20
});

describe('a sticky note', () => {
    test('it is paper with an edge, drawn without any wobble', () => {
        const paths = pathsOfElement(note('n', 'buy milk'));
        expect(paths.map((path) => path.role)).toEqual(['fill', 'stroke']);
        expect(paths[0]!.d).toBe(paths[1]!.d);
    });

    test('the paper and its edge come from their own palettes, never from the drawing colors', () => {
        const svg = toSvg([note('n', 'buy milk')], {
            palette,
            paper: { ...palette, yellow: 'var(paper-yellow)' },
            edge: { ...palette, yellow: 'var(edge-yellow)' }
        });
        expect(svg).toContain('fill="var(paper-yellow)"');
        expect(svg).toContain('stroke="var(edge-yellow)"');
        expect(svg).toContain('buy milk');
    });

    test('its words start inside the padding, not at the corner of the paper', () => {
        const svg = toSvg([note('n', 'hi')], { palette });
        expect(svg).toContain('<tspan x="16" y="36"');
    });

    test('a note reads as what it says', () => {
        expect(readingOrder([note('n', 'buy milk', 0, 0)])).toEqual(['buy milk']);
    });
});

describe('toSvg', () => {
    const svg = toSvg([rect('a'), text('t', 'hello & <you>', 20, 20)], { palette, background: '#fff' });

    test('it opens a document around the drawing with room to spare', () => {
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
        expect(svg).toContain('viewBox="-32 -32 164 124"');
    });

    test('the text is escaped and named by its font', () => {
        expect(svg).toContain('hello &amp; &lt;you&gt;');
        expect(svg).toContain('Kalam');
    });

    test('colors come from the palette of the theme it was exported in', () => {
        expect(svg).toContain('stroke="var(ink)"');
    });

    test('without a background the paper stays transparent', () => {
        expect(toSvg([rect('a')], { palette })).not.toContain('<rect');
    });
});

describe('readingOrder', () => {
    test('texts read top to bottom and left to right', () => {
        const lines = readingOrder([text('c', 'third', 0, 200), text('b', 'second', 300, 10), text('a', 'first', 0, 0)]);
        expect(lines).toEqual(['first', 'second', 'third']);
    });

    test('an arrow between two labeled boxes becomes a line of its own', () => {
        const elements: DrawingElement[] = [
            rect('box-a', 0, 0),
            text('label-a', 'Client', 10, 20),
            rect('box-b', 300, 0),
            text('label-b', 'Daemon', 310, 20),
            line('arrow', [100, 30], [300, 30])
        ];
        expect(readingOrder(elements).at(-1)).toBe('Client -> Daemon');
    });

    test('a line without a head is not a connection', () => {
        const elements: DrawingElement[] = [text('a', 'Client', 0, 0), text('b', 'Daemon', 300, 0), line('line', [80, 10], [300, 10], false)];
        expect(readingOrder(elements)).toEqual(['Client', 'Daemon']);
    });
});
