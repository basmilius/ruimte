import { GROUP_HEADER, GROUP_PADDING, type ProjectNode } from '@ruimte/contracts';

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

/*
 * The rectangle a group holds its members in. A collapsed group is drawn as its header alone, but
 * its members keep the places they had, so what a new one has to fit inside is the height it goes
 * back to when it opens.
 */
export const groupRect = (group: ProjectNode): Rect => ({
    x: group.x,
    y: group.y,
    w: group.w,
    h: group.collapsed === true ? (group.expandedHeight ?? group.h) : group.h
});

/*
 * What a group holds. Open, that is read off the positions, the same center-in-rect test the client
 * runs (`membersOf` in `apps/client/src/state/canvas.ts`); collapsed, the file spells it out,
 * because the members sit nowhere near the header the group has shrunk to.
 */
export const groupMembers = (group: ProjectNode, nodes: readonly ProjectNode[]): ProjectNode[] => {
    if (group.collapsed === true) {
        const ids = new Set(group.memberIds ?? []);
        return nodes.filter((node) => ids.has(node.id));
    }
    const rect = groupRect(group);
    return nodes.filter(
        (node) =>
            node.id !== group.id &&
            node.x + node.w / 2 >= rect.x &&
            node.x + node.w / 2 <= rect.x + rect.w &&
            node.y + node.h / 2 >= rect.y &&
            node.y + node.h / 2 <= rect.y + rect.h
    );
};

/*
 * A free spot inside a group, in rows under its title bar, and the group as it has to become to
 * hold it. The node goes in whether or not the group has room: a refusal over geometry would be a
 * puzzle nobody can solve from a terminal, so the frame grows instead.
 */
export const placeInGroup = (group: ProjectNode, members: readonly Rect[], size: { w: number; h: number }): { rect: Rect; grown: Rect } => {
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
