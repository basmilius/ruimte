import { describe, expect, test } from 'bun:test';
import { GROUP_HEADER, GROUP_PADDING, type ProjectNode } from '@ruimte/contracts';
import {
    ARRANGE_LAYOUTS,
    PLACEMENT_GAP,
    TEAM_COLUMNS,
    arrangeRects,
    containersOf,
    gridColumns,
    groupMembers,
    placeBeside,
    placeFree,
    placeInGroup,
    placeTeam,
    type Rect
} from './placement.ts';

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

describe('placeTeam', () => {
    const terminal = { w: 560, h: 360 };
    const chat = { w: 480, h: 520 };

    test('three of a kind stand in one row under the title bar, without overlap', () => {
        const { rects, frame } = placeTeam([terminal, terminal, terminal]);
        expect(rects.map((rect) => rect.y)).toEqual([GROUP_HEADER + GROUP_PADDING, GROUP_HEADER + GROUP_PADDING, GROUP_HEADER + GROUP_PADDING]);
        expect(rects.map((rect) => rect.x)).toEqual([GROUP_PADDING, GROUP_PADDING + 560 + PLACEMENT_GAP, GROUP_PADDING + (560 + PLACEMENT_GAP) * 2]);
        expect(frame.w).toBe(GROUP_PADDING * 2 + 560 * 3 + PLACEMENT_GAP * 2);
        expect(frame.h).toBe(GROUP_HEADER + GROUP_PADDING * 2 + 360);
    });

    test(`past ${TEAM_COLUMNS} it starts a second row and the frame holds both`, () => {
        const { rects, frame } = placeTeam(Array.from({ length: TEAM_COLUMNS + 1 }, () => terminal));
        expect(rects[TEAM_COLUMNS]!.x).toBe(GROUP_PADDING);
        expect(rects[TEAM_COLUMNS]!.y).toBe(GROUP_HEADER + GROUP_PADDING + 360 + PLACEMENT_GAP);
        expect(frame.h).toBe(GROUP_HEADER + GROUP_PADDING * 2 + 360 * 2 + PLACEMENT_GAP);
    });

    test('mixed sizes keep their gap and the frame is measured from the tallest', () => {
        const { rects, frame } = placeTeam([terminal, chat]);
        expect(rects[1]!.x).toBe(GROUP_PADDING + 560 + PLACEMENT_GAP);
        expect(frame.h).toBe(GROUP_HEADER + GROUP_PADDING * 2 + 520);
        const overlapping = rects.some((rect, index) =>
            rects.some(
                (other, otherIndex) =>
                    index !== otherIndex && rect.x < other.x + other.w && other.x < rect.x + rect.w && rect.y < other.y + other.h && other.y < rect.y + rect.h
            )
        );
        expect(overlapping).toBe(false);
    });

    test('one role gets a frame of its own size', () => {
        const { rects, frame } = placeTeam([chat]);
        expect(rects[0]).toEqual({ x: GROUP_PADDING, y: GROUP_HEADER + GROUP_PADDING, ...chat });
        expect(frame).toEqual({ w: GROUP_PADDING * 2 + 480, h: GROUP_HEADER + GROUP_PADDING * 2 + 520 });
    });
});

describe('arrangeRects', () => {
    const rect = (x: number, y: number, w = 200, h = 100): Rect => ({ x, y, w, h });

    const overlapping = (rects: readonly Rect[]): boolean =>
        rects.some((one, index) =>
            rects.some(
                (other, otherIndex) =>
                    index !== otherIndex && one.x < other.x + other.w && other.x < one.x + one.w && one.y < other.y + other.h && other.y < one.y + one.h
            )
        );

    test('a grid without --cols is as square as the count allows and starts where the nodes already stood', () => {
        const rects = [rect(400, 300), rect(-20, 1000), rect(900, 20), rect(50, 50)];
        const placed = arrangeRects(rects, 'grid');
        expect(gridColumns(4)).toBe(2);
        expect(placed.map((one) => one.x)).toEqual([-20, 220, -20, 220]);
        expect(placed.map((one) => one.y)).toEqual([20, 20, 160, 160]);
        expect(overlapping(placed)).toBe(false);
    });

    test('--cols is how many go on a row, and the last row is as short as what is left', () => {
        const rects = Array.from({ length: 5 }, () => rect(0, 0));
        const placed = arrangeRects(rects, 'grid', 3);
        expect(placed.map((one) => one.x)).toEqual([0, 240, 480, 0, 240]);
        expect(placed.map((one) => one.y)).toEqual([0, 0, 0, 140, 140]);
    });

    test('a row is one row and a column is one column, whatever --cols would have said', () => {
        const rects = Array.from({ length: 3 }, () => rect(10, 10));
        expect(arrangeRects(rects, 'row').map((one) => one.y)).toEqual([10, 10, 10]);
        expect(arrangeRects(rects, 'row').map((one) => one.x)).toEqual([10, 250, 490]);
        expect(arrangeRects(rects, 'column').map((one) => one.x)).toEqual([10, 10, 10]);
        expect(arrangeRects(rects, 'column').map((one) => one.y)).toEqual([10, 150, 290]);
    });

    test('one node stays exactly where it is, in every layout', () => {
        for (const layout of ARRANGE_LAYOUTS) {
            expect(arrangeRects([rect(123, 456)], layout)).toEqual([rect(123, 456)]);
        }
        expect(arrangeRects([], 'grid')).toEqual([]);
    });

    test('a column is as wide as its widest node and a row as tall as its tallest', () => {
        const placed = arrangeRects([rect(0, 0, 560, 360), rect(0, 0, 320, 240), rect(0, 0, 200, 520), rect(0, 0, 480, 100)], 'grid', 2);
        expect(placed.map((one) => one.x)).toEqual([0, 600, 0, 600]);
        expect(placed.map((one) => one.y)).toEqual([0, 0, 400, 400]);
        expect(overlapping(placed)).toBe(false);
    });

    test('the corner it starts from is the top left of the box the nodes already occupy', () => {
        const placed = arrangeRects([rect(1000, 40), rect(-300.4, 700.6)], 'row');
        expect(placed.map((one) => one.x)).toEqual([-300, -60]);
        expect(placed.map((one) => one.y)).toEqual([40, 40]);
    });
});

describe('containersOf', () => {
    const outer: ProjectNode = { id: 'outer', kind: 'group', title: 'Outer', x: 0, y: 0, w: 1000, h: 1000 };
    const inner: ProjectNode = { id: 'inner', kind: 'group', title: 'Inner', x: 100, y: 100, w: 400, h: 400 };
    const deep: ProjectNode = { id: 'deep', kind: 'note', title: 'deep', x: 150, y: 150, w: 100, h: 100 };
    const loose: ProjectNode = { id: 'loose', kind: 'note', title: 'loose', x: 600, y: 600, w: 100, h: 100 };
    const away: ProjectNode = { id: 'away', kind: 'note', title: 'away', x: 5000, y: 0, w: 100, h: 100 };

    test('nested frames resolve to the innermost one and a node on the canvas is in none', () => {
        const containers = containersOf([outer, inner, deep, loose, away]);
        expect(containers.get('deep')?.id).toBe('inner');
        expect(containers.get('inner')?.id).toBe('outer');
        expect(containers.get('loose')?.id).toBe('outer');
        expect(containers.has('away')).toBe(false);
    });

    test('a collapsed frame is what the file says it holds', () => {
        const folded: ProjectNode = { ...inner, collapsed: true, h: 39, expandedHeight: 400, memberIds: ['away'] };
        const containers = containersOf([folded, deep, away]);
        expect(containers.get('away')?.id).toBe('inner');
        expect(containers.has('deep')).toBe(false);
    });
});
