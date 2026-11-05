import { ARRANGE_LAYOUTS } from '@ruimte/actions';
import { arrangeRects, GROUP_HEADER, GROUP_PADDING, gridColumns, groupMemberIds, groupRect, PLACEMENT_GAP, type ProjectNode } from '@ruimte/contracts';

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w + PLACEMENT_GAP && b.x < a.x + a.w + PLACEMENT_GAP && a.y < b.y + b.h + PLACEMENT_GAP && b.y < a.y + a.h + PLACEMENT_GAP;
}

/* Right of the anchor, top edges level, whatever is there already: the caller named the anchor. */
export function placeBeside(anchor: Rect, size: { w: number; h: number }): Rect {
    return {
        x: Math.round(anchor.x + anchor.w + PLACEMENT_GAP),
        y: Math.round(anchor.y),
        ...size
    };
}

/*
 * Where a node lands without an anchor that was asked for. Next to the caller it walks right past
 * whatever is in the way, so an agent that adds three nodes gets a row beside itself; without a
 * caller on the canvas it goes right of everything, which cannot overlap anything.
 */
export function placeFree(existing: readonly Rect[], size: { w: number; h: number }, caller: Rect | null): Rect {
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
}

// The layouts are the catalog's, since `node.arrange` takes one as input; the arithmetic lives in contracts for the client's group arrange.
export { ARRANGE_LAYOUTS, arrangeRects, gridColumns, PLACEMENT_GAP };
export type ArrangeLayout = (typeof ARRANGE_LAYOUTS)[number];

/* What placing inside a group needs to know about it, so a frame that is not a node yet also fits. */
type GroupFrame = Pick<ProjectNode, 'x' | 'y' | 'w' | 'h' | 'collapsed' | 'expandedHeight'>;

/* What a group holds by the project document's own rule (`groupMemberIds`), in canvas order. */
export function groupMembers(group: ProjectNode, nodes: readonly ProjectNode[]): ProjectNode[] {
    const ids = new Set(groupMemberIds(group, nodes));
    return nodes.filter((node) => ids.has(node.id));
}

/*
 * The group each node stands in, by node id. A node in nested frames is in both by geometry, and the
 * smaller one is the one a person would say it is in.
 */
export function containersOf(nodes: readonly ProjectNode[]): Map<string, ProjectNode> {
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
}

/*
 * A free spot inside a group, in rows under its title bar, and the group as it has to become to
 * hold it. The node goes in whether or not the group has room: a refusal over geometry would be a
 * puzzle nobody can solve from a terminal, so the frame grows instead.
 */
export function placeInGroup(group: GroupFrame, members: readonly Rect[], size: { w: number; h: number }): { rect: Rect; grown: Rect } {
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
}

// How wide a team stands before it starts a second row: a full team of sixteen then reads as four rows of four.
export const TEAM_COLUMNS = 4;

/*
 * Where a whole team stands inside its group, and how big that group has to be. Every member goes
 * through `placeInGroup`, so a team member lands where a single node would. The rectangles are
 * relative to the group's own corner.
 */
export function placeTeam(sizes: readonly { w: number; h: number }[]): { rects: Rect[]; frame: { w: number; h: number } } {
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
}
