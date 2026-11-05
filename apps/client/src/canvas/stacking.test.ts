import { describe, expect, test } from 'bun:test';
import { nodesOverBrowsers, stackingOrder, type StackedNode } from '@/canvas/stacking';

function at(kind: StackedNode['kind'], x: number, y: number): StackedNode {
    return { kind, x, y, w: 100, h: 100 };
}

describe('stackingOrder', () => {
    test('counts from one in the order given', () => {
        const nodes = { a: at('terminal', 0, 0), b: at('chat', 0, 0) };
        expect(stackingOrder(nodes, ['a', 'b'])).toEqual({ a: 1, b: 2 });
    });

    test('keeps duplicate positions, missing nodes and prototype-like ids as own keys', () => {
        const nodes = Object.fromEntries([
            ['__proto__', at('group', 0, 0)],
            ['a', at('note', 0, 0)]
        ]);
        for (const extra of [[], Array.from({ length: 256 }, (_, index) => `extra-${index}`)]) {
            const stacking = stackingOrder(nodes, ['a', '__proto__', 'missing', 'a', ...extra]);

            expect(Object.hasOwn(stacking, '__proto__')).toBe(true);
            expect(Object.getPrototypeOf(stacking)).toBe(Object.prototype);
            expect(Object.entries(stacking).slice(0, 3)).toEqual([
                ['__proto__', 1],
                ['a', 4],
                ['missing', 3]
            ]);
        }
    });

    test('puts every group under every other node', () => {
        const nodes = { a: at('terminal', 0, 0), g: at('group', 0, 0) };
        expect(stackingOrder(nodes, ['a', 'g'])).toEqual({ g: 1, a: 2 });
    });

    test('puts a group over the groups that hold it, whatever its place in the order', () => {
        const nodes = {
            inner: { ...at('group', 100, 100), w: 280, h: 240 },
            outer: { ...at('group', 0, 0), w: 320, h: 280 },
            held: { ...at('group', 2000, 0), memberIds: [], membersListed: true },
            holder: { ...at('group', 4000, 0), memberIds: ['held'] }
        };
        expect(stackingOrder(nodes, ['inner', 'held', 'outer', 'holder'])).toEqual({ outer: 1, holder: 2, inner: 3, held: 4 });
    });
});

describe('nodesOverBrowsers', () => {
    const empty = new Set<string>();
    const over = (nodes: Record<string, StackedNode>, order: string[], hidden = empty, ringed = empty) => nodesOverBrowsers(nodes, order, hidden, ringed);

    test('answers nothing for a browser nobody overlaps', () => {
        expect(over({ page: at('browser', 0, 0), other: at('terminal', 500, 0) }, ['page', 'other'])).toEqual({});
    });

    test('gives the shape of a node standing over the page', () => {
        const nodes = { page: at('browser', 0, 0), other: at('terminal', 50, 50) };
        expect(over(nodes, ['page', 'other'])).toEqual({ page: [{ x: 50, y: 50, w: 100, h: 100, radius: 12 }] });
    });

    test('leaves room for the ring of a selected node', () => {
        const nodes = { page: at('browser', 0, 0), other: at('terminal', 50, 50) };
        expect(over(nodes, ['page', 'other'], empty, new Set(['other']))).toEqual({ page: [{ x: 48, y: 48, w: 104, h: 104, radius: 14 }] });
    });

    test('leaves a page that stands over the node it overlaps', () => {
        expect(over({ other: at('terminal', 50, 50), page: at('browser', 0, 0) }, ['other', 'page'])).toEqual({});
    });

    test('a group under a page never covers it', () => {
        expect(over({ page: at('browser', 0, 0), group: at('group', 0, 0) }, ['page', 'group'])).toEqual({});
    });

    test('a node inside a collapsed group covers nothing', () => {
        const nodes = { page: at('browser', 0, 0), other: at('terminal', 50, 50) };
        expect(over(nodes, ['page', 'other'], new Set(['other']))).toEqual({});
    });

    test('a browser under another browser gets a hole for it', () => {
        const nodes = { under: at('browser', 0, 0), over: at('browser', 50, 50) };
        expect(over(nodes, ['under', 'over'])).toEqual({ under: [{ x: 50, y: 50, w: 100, h: 100, radius: 12 }] });
    });
});
