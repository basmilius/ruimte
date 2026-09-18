import { GROUP_HEADER, GROUP_PADDING, groupMemberIds, groupRect, type ProjectNode } from '@ruimte/contracts';

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

// The room between a node and the one placed next to it; a multiple of the client's 8 px grid.
export const PLACEMENT_GAP = 40;

const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w + PLACEMENT_GAP && b.x < a.x + a.w + PLACEMENT_GAP && a.y < b.y + b.h + PLACEMENT_GAP && b.y < a.y + a.h + PLACEMENT_GAP;

/* Right of the anchor, top edges level, whatever is there already: the caller named the anchor. */
export const placeBeside = (anchor: Rect, size: { w: number; h: number }): Rect => ({
    x: Math.round(anchor.x + anchor.w + PLACEMENT_GAP),
    y: Math.round(anchor.y),
    ...size
});

/*
 * Where a node lands without an anchor that was asked for. Next to the caller it walks right past
 * whatever is in the way, so an agent that adds three nodes gets a row beside itself; without a
 * caller on the canvas it goes right of everything, which cannot overlap anything.
 */
export const placeFree = (existing: readonly Rect[], size: { w: number; h: number }, caller: Rect | null): Rect => {
    if (caller) {
        const spot = { ...placeBeside(caller, size) };
        for (;;) {
            const blocking = existing.filter((rect) => overlaps(spot, rect));
            if (blocking.length === 0) {
                return spot;
            }
            spot.x = Math.round(Math.max(...blocking.map((rect) => rect.x + rect.w)) + PLACEMENT_GAP);
        }
    }
    if (existing.length === 0) {
        return { x: 0, y: 0, ...size };
    }
    return {
        x: Math.round(Math.max(...existing.map((rect) => rect.x + rect.w)) + PLACEMENT_GAP),
        y: Math.round(Math.min(...existing.map((rect) => rect.y))),
        ...size
    };
};

export const ARRANGE_LAYOUTS = ['grid', 'row', 'column'] as const;
export type ArrangeLayout = (typeof ARRANGE_LAYOUTS)[number];

/* How many columns a grid takes without being told: as square as the count allows. */
export const gridColumns = (count: number): number => Math.ceil(Math.sqrt(count));

/*
 * The same rectangles tidied into a block, in the order they came in. The origin is the top left of
 * the box they already occupy, so a canvas is straightened where it stands and nothing jumps off
 * screen; a single node therefore never moves at all. A column is as wide as the widest node in it
 * and a row as tall as the tallest, which is what keeps nodes of different sizes from touching
 * without resizing any of them.
 */
export const arrangeRects = (rects: readonly Rect[], layout: ArrangeLayout, cols?: number): Rect[] => {
    if (rects.length === 0) {
        return [];
    }
    const columns = layout === 'row' ? rects.length : layout === 'column' ? 1 : Math.min(cols ?? gridColumns(rects.length), rects.length);
    const origin = {
        x: Math.round(Math.min(...rects.map((rect) => rect.x))),
        y: Math.round(Math.min(...rects.map((rect) => rect.y)))
    };
    const columnOf = (index: number): number => index % columns;
    const rowOf = (index: number): number => Math.floor(index / columns);
    const widths: number[] = [];
    const heights: number[] = [];
    for (const [index, rect] of rects.entries()) {
        widths[columnOf(index)] = Math.max(widths[columnOf(index)] ?? 0, rect.w);
        heights[rowOf(index)] = Math.max(heights[rowOf(index)] ?? 0, rect.h);
    }
    const offsets = (sizes: readonly number[]): number[] => {
        const places: number[] = [];
        let at = 0;
        for (const size of sizes) {
            places.push(at);
            at += size + PLACEMENT_GAP;
        }
        return places;
    };
    const left = offsets(widths);
    const top = offsets(heights);
    return rects.map((rect, index) => ({
        x: Math.round(origin.x + left[columnOf(index)]!),
        y: Math.round(origin.y + top[rowOf(index)]!),
        w: rect.w,
        h: rect.h
    }));
};

/* What placing inside a group needs to know about it, so a frame that is not a node yet also fits. */
type GroupFrame = Pick<ProjectNode, 'x' | 'y' | 'w' | 'h' | 'collapsed' | 'expandedHeight'>;

/*
 * What a group holds, as nodes rather than ids: which things lie inside a frame is the project
 * document's own rule (`groupMemberIds`), shared with whatever else has to answer it, and this side
 * only needs the nodes back in the order the canvas keeps them.
 */
export const groupMembers = (group: ProjectNode, nodes: readonly ProjectNode[]): ProjectNode[] => {
    const ids = new Set(groupMemberIds(group, nodes));
    return nodes.filter((node) => ids.has(node.id));
};

/*
 * The group each node stands in, by node id, with nested frames resolved to the innermost one: a
 * node inside a group inside a group is in both by geometry, and the smaller frame is the one a
 * person would say it is in. A node on the canvas itself is not in the map.
 */
export const containersOf = (nodes: readonly ProjectNode[]): Map<string, ProjectNode> => {
    const containers = new Map<string, ProjectNode>();
    const area = (group: ProjectNode): number => {
        const rect = groupRect(group);
        return rect.w * rect.h;
    };
    for (const group of nodes.filter((node) => node.kind === 'group')) {
        for (const member of groupMembers(group, nodes)) {
            const current = containers.get(member.id);
            if (!current || area(group) < area(current)) {
                containers.set(member.id, group);
            }
        }
    }
    return containers;
};

/*
 * A free spot inside a group, in rows under its title bar, and the group as it has to become to
 * hold it. The node goes in whether or not the group has room: a refusal over geometry would be a
 * puzzle nobody can solve from a terminal, so the frame grows instead.
 */
export const placeInGroup = (group: GroupFrame, members: readonly Rect[], size: { w: number; h: number }): { rect: Rect; grown: Rect } => {
    const rect = groupRect(group);
    const left = Math.round(rect.x + GROUP_PADDING);
    const right = rect.x + rect.w - GROUP_PADDING;
    const spot = { x: left, y: Math.round(rect.y + GROUP_HEADER + GROUP_PADDING), ...size };
    for (;;) {
        const blocking = members.filter((member) => overlaps(spot, member));
        if (blocking.length === 0) {
            break;
        }
        const beside = Math.round(Math.max(...blocking.map((member) => member.x + member.w)) + PLACEMENT_GAP);
        if (beside + size.w <= right) {
            spot.x = beside;
            continue;
        }
        // Past the right edge, so a row of its own under everything that was in the way; y only ever grows.
        spot.x = left;
        spot.y = Math.round(Math.max(...blocking.map((member) => member.y + member.h)) + PLACEMENT_GAP);
    }
    return {
        rect: spot,
        grown: {
            x: rect.x,
            y: rect.y,
            w: Math.max(rect.w, spot.x + size.w + GROUP_PADDING - rect.x),
            h: Math.max(rect.h, spot.y + size.h + GROUP_PADDING - rect.y)
        }
    };
};

// How wide a team stands before it starts a second row: a full team of sixteen then reads as four rows of four.
export const TEAM_COLUMNS = 4;

/*
 * Where a whole team stands inside the group that holds it, and how big that group has to be. The
 * frame starts as wide as a row of members and every one of them is placed by `placeInGroup`, which
 * walks to the right until the row is full and then starts another, so the two ways a node lands in
 * a group put it in the same kind of spot. The rectangles are relative to the group's own corner:
 * the caller decides where the group lands and moves everything by that much.
 */
export const placeTeam = (sizes: readonly { w: number; h: number }[]): { rects: Rect[]; frame: { w: number; h: number } } => {
    const widest = Math.max(...sizes.map((size) => size.w));
    const columns = Math.min(TEAM_COLUMNS, sizes.length);
    let frame = {
        x: 0,
        y: 0,
        w: GROUP_PADDING * 2 + columns * widest + (columns - 1) * PLACEMENT_GAP,
        h: GROUP_HEADER + GROUP_PADDING * 2
    };
    const rects: Rect[] = [];
    for (const size of sizes) {
        const placed = placeInGroup(frame, rects, size);
        rects.push(placed.rect);
        frame = { ...frame, w: placed.grown.w, h: placed.grown.h };
    }
    return { rects, frame: { w: frame.w, h: frame.h } };
};
