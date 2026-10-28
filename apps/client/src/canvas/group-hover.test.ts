import { describe, expect, test } from 'bun:test';
import { hoveredGroup } from '@/canvas/group-hover';
import type { StackedNode } from '@/canvas/stacking';

function at(kind: StackedNode['kind'], x: number, y: number, w: number, h: number): StackedNode {
    return { kind, x, y, w, h };
}

const none = new Set<string>();

describe('hoveredGroup', () => {
    test('stays on the group while the pointer is over a node inside it', () => {
        const nodes = { outer: at('group', 0, 0, 400, 300), agent: at('chat', 40, 60, 200, 150) };

        expect(hoveredGroup(nodes, ['outer', 'agent'], none, { x: 100, y: 100 })).toBe('outer');
    });

    test('answers nothing outside every group or without a pointer', () => {
        const nodes = { outer: at('group', 0, 0, 400, 300) };

        expect(hoveredGroup(nodes, ['outer'], none, { x: 500, y: 100 })).toBeNull();
        expect(hoveredGroup(nodes, ['outer'], none, null)).toBeNull();
    });

    test('takes the topmost of two nested groups', () => {
        const nodes = { outer: at('group', 0, 0, 400, 300), inner: at('group', 20, 40, 200, 200) };

        expect(hoveredGroup(nodes, ['inner', 'outer'], none, { x: 100, y: 100 })).toBe('outer');
        expect(hoveredGroup(nodes, ['outer', 'inner'], none, { x: 100, y: 100 })).toBe('inner');
        expect(hoveredGroup(nodes, ['outer', 'inner'], none, { x: 300, y: 100 })).toBe('outer');
    });

    test('skips a hidden group', () => {
        const nodes = { outer: at('group', 0, 0, 400, 300), inner: at('group', 20, 40, 200, 200) };

        expect(hoveredGroup(nodes, ['outer', 'inner'], new Set(['inner']), { x: 100, y: 100 })).toBe('outer');
    });
});
