import { describe, expect, test } from 'bun:test';
import { GROUP_HEADER, GROUP_PADDING, type ProjectNode } from '@ruimte/contracts';
import { PLACEMENT_GAP, groupMembers, placeBeside, placeFree, placeInGroup } from './placement.ts';

const size = { w: 320, h: 240 };

describe('placeBeside', () => {
    test('puts the node right of the anchor with its top level', () => {
        expect(placeBeside({ x: 10, y: 20, w: 100, h: 50 }, size)).toEqual({ x: 110 + PLACEMENT_GAP, y: 20, ...size });
    });

    test('follows the anchor wherever it is, never the row the others are on', () => {
        const anchor = { x: -4000, y: 2400, w: 320, h: 240 };
        expect(placeBeside(anchor, size)).toEqual({ x: -4000 + 320 + PLACEMENT_GAP, y: 2400, ...size });
    });

    test('rounds to whole pixels', () => {
        expect(placeBeside({ x: 0.4, y: 7.6, w: 99.3, h: 50 }, size)).toEqual({ x: 140, y: 8, ...size });
    });
});

describe('placeFree', () => {
    test('an empty canvas starts at the origin', () => {
        expect(placeFree([], size, null)).toEqual({ x: 0, y: 0, ...size });
    });

    test('without a caller it goes right of everything, level with the top', () => {
        const existing = [
            { x: 0, y: 100, w: 200, h: 200 },
            { x: 500, y: -50, w: 100, h: 100 }
        ];
        expect(placeFree(existing, size, null)).toEqual({ x: 600 + PLACEMENT_GAP, y: -50, ...size });
    });

    test('beside the caller when that spot is free', () => {
        const caller = { x: 0, y: 0, w: 560, h: 360 };
        expect(placeFree([caller], size, caller)).toEqual({ x: 560 + PLACEMENT_GAP, y: 0, ...size });
    });

    test('walks right past whatever is in the way of the caller', () => {
        const caller = { x: 0, y: 0, w: 560, h: 360 };
        const first = { x: 600, y: 0, w: 320, h: 240 };
        const second = { x: 960, y: 100, w: 320, h: 240 };
        const below = { x: 600, y: 2000, w: 320, h: 240 };
        const spot = placeFree([caller, first, second, below], size, caller);
        expect(spot).toEqual({ x: 1280 + PLACEMENT_GAP, y: 0, ...size });
    });

    test('keeps a gap to a neighbor that only nearly touches', () => {
        const caller = { x: 0, y: 0, w: 100, h: 100 };
        const near = { x: 100 + PLACEMENT_GAP + size.w + 10, y: 0, w: 100, h: 100 };
        expect(placeFree([caller, near], size, caller).x).toBe(near.x + near.w + PLACEMENT_GAP);
    });
});

describe('placeInGroup', () => {
    const group = (over: Partial<ProjectNode> = {}): ProjectNode => ({ id: 'g', kind: 'group', title: 'Work', x: 100, y: 100, w: 900, h: 800, ...over });

    test('puts the first one under the title bar, inside the padding', () => {
        const { rect, grown } = placeInGroup(group(), [], { w: 200, h: 100 });
        expect(rect).toEqual({ x: 100 + GROUP_PADDING, y: 100 + GROUP_HEADER + GROUP_PADDING, w: 200, h: 100 });
        expect(grown).toEqual({ x: 100, y: 100, w: 900, h: 800 });
    });

    test('walks right past what is in the way and wraps to a row of its own', () => {
        const taken = { x: 100 + GROUP_PADDING, y: 100 + GROUP_HEADER + GROUP_PADDING, w: 700, h: 100 };
        const { rect } = placeInGroup(group(), [taken], { w: 200, h: 100 });
        expect(rect.x).toBe(100 + GROUP_PADDING);
        expect(rect.y).toBe(taken.y + 100 + PLACEMENT_GAP);
    });

    test('the group grows when what goes in it does not fit', () => {
        const { grown } = placeInGroup(group({ w: 200, h: 120 }), [], { w: 400, h: 300 });
        expect(grown.w).toBe(GROUP_PADDING + 400 + GROUP_PADDING);
        expect(grown.h).toBe(GROUP_HEADER + GROUP_PADDING + 300 + GROUP_PADDING);
    });

    test('a collapsed group is measured by the height it opens back to', () => {
        const folded = group({ collapsed: true, h: 39, expandedHeight: 800 });
        const { rect, grown } = placeInGroup(folded, [], { w: 200, h: 100 });
        expect(rect.y).toBe(100 + GROUP_HEADER + GROUP_PADDING);
        expect(grown.h).toBe(800);
    });
});

describe('groupMembers', () => {
    const inside: ProjectNode = { id: 'a', kind: 'note', title: 'a', x: 150, y: 200, w: 100, h: 100 };
    const outside: ProjectNode = { id: 'b', kind: 'note', title: 'b', x: 5000, y: 0, w: 100, h: 100 };

    test('an open group is read off the positions, by the center of a node', () => {
        const open: ProjectNode = { id: 'g', kind: 'group', title: 'Work', x: 100, y: 100, w: 900, h: 800 };
        expect(groupMembers(open, [open, inside, outside]).map((node) => node.id)).toEqual(['a']);
    });

    test('a collapsed group is what the file says, since its members sit nowhere near it', () => {
        const folded: ProjectNode = { id: 'g', kind: 'group', title: 'Work', x: 100, y: 100, w: 900, h: 39, collapsed: true, memberIds: ['b'] };
        expect(groupMembers(folded, [folded, inside, outside]).map((node) => node.id)).toEqual(['b']);
    });
});
