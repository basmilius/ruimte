import { arrangeRects, CANVAS_GRID, GROUP_HEADER, GROUP_PADDING, groupMemberIds, type GroupItem } from '@ruimte/contracts';
import { snapToGrid as snap, type Point, type Rect } from '@/canvas-model/math';
import type { CanvasNode, TextElement } from '@/state/canvas';

/* Whether the arrange command is offered for this selection; the menu and the palette share it. */
export function groupArrangeable(selected: CanvasNode | undefined, locks: { move: boolean }): boolean {
    return selected?.kind === 'group' && selected.collapsed !== true && !locks.move;
}

export type ArrangeRefusal = 'collapsed' | 'empty' | 'locked' | 'membership';

export type ArrangeResult = { moves: Record<string, Point>; frame: Rect } | { refused: ArrangeRefusal };

function snapUp(value: number): number {
    return Math.ceil(value / CANVAS_GRID) * CANVAS_GRID;
}

function itemsOf(nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>): GroupItem[] {
    return [...Object.values(nodes), ...Object.values(texts)];
}

/* Which ids every group holds, so the frame growing or a node moving can be checked against what it did before. */
function membershipOf(nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>): Map<string, string> {
    const items = itemsOf(nodes, texts);
    return new Map(
        Object.values(nodes)
            .filter((node) => node.kind === 'group')
            .map((group) => [group.id, groupMemberIds(group, items).sort().join('\n')])
    );
}

/*
 * The members that stand directly in a group, tidied into a grid under its title bar. A group inside it
 * moves as one block with what it holds, texts stay where they are, and the frame only ever grows.
 * It refuses where a move or the grown frame would take a node into or out of a group that reads its
 * members off positions, since a tidy-up must not regroup anything.
 */
export function arrangeGroupMembers(groupId: string, nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>): ArrangeResult {
    const group = nodes[groupId];
    if (group === undefined || group.kind !== 'group') {
        return { refused: 'empty' };
    }
    if (group.collapsed) {
        return { refused: 'collapsed' };
    }
    const items = itemsOf(nodes, texts);
    const memberIds = groupMemberIds(group, items);
    const members = memberIds.flatMap((id) => (nodes[id] === undefined ? [] : [nodes[id]]));
    const inNestedGroup = new Set(members.filter((member) => member.kind === 'group').flatMap((nested) => groupMemberIds(nested, items)));
    const direct = members.filter((member) => !inNestedGroup.has(member.id)).sort((a, b) => a.y - b.y || a.x - b.x);
    if (direct.length === 0) {
        return { refused: 'empty' };
    }

    const placed = arrangeRects(direct, 'grid');
    const originX = Math.min(...direct.map((member) => member.x));
    const originY = Math.min(...direct.map((member) => member.y));
    const targetX = snap(group.x + GROUP_PADDING);
    const targetY = snap(group.y + GROUP_HEADER + GROUP_PADDING);

    const moves: Record<string, Point> = {};
    const carry = (carrier: CanvasNode, delta: Point, seen: Set<string>): void => {
        if (carrier.kind !== 'group') {
            return;
        }
        for (const id of groupMemberIds(carrier, items)) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            const node = nodes[id];
            const text = texts[id];
            const at = node ?? text;
            if (at !== undefined) {
                moves[id] = { x: at.x + delta.x, y: at.y + delta.y };
            }
            if (node !== undefined) {
                carry(node, delta, seen);
            }
        }
    };
    const carried = new Set<string>(direct.map((member) => member.id));
    for (const [index, member] of direct.entries()) {
        const rect = placed[index]!;
        const to = { x: snap(targetX + rect.x - originX), y: snap(targetY + rect.y - originY) };
        if (to.x !== member.x || to.y !== member.y) {
            moves[member.id] = to;
            carry(member, { x: to.x - member.x, y: to.y - member.y }, carried);
        }
    }

    const right = Math.max(...direct.map((member) => (moves[member.id]?.x ?? member.x) + member.w));
    const bottom = Math.max(...direct.map((member) => (moves[member.id]?.y ?? member.y) + member.h));
    const frame: Rect = {
        x: group.x,
        y: group.y,
        w: Math.max(group.w, snapUp(right + GROUP_PADDING - group.x)),
        h: Math.max(group.h, snapUp(bottom + GROUP_PADDING - group.y))
    };

    const movedNodes = Object.fromEntries(
        Object.entries(nodes).map(([id, node]) => {
            const to = moves[id];
            return [id, id === groupId ? { ...node, w: frame.w, h: frame.h } : to === undefined ? node : { ...node, ...to }];
        })
    );
    const movedTexts = Object.fromEntries(
        Object.entries(texts).map(([id, text]) => {
            const to = moves[id];
            return [id, to === undefined ? text : { ...text, ...to }];
        })
    );
    const before = membershipOf(nodes, texts);
    const after = membershipOf(movedNodes, movedTexts);
    for (const [id, members] of before) {
        if (after.get(id) !== members) {
            return { refused: 'membership' };
        }
    }
    return { moves, frame };
}
