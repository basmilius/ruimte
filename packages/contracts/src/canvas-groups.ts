import { groupMemberIds, spellsOutMembers, withMemberIds, type GroupItem, type NodeRect } from './node-defaults.ts';
import type { ProjectCanvasView, ProjectNode } from './project.ts';

/* Every id the named groups hold, through the groups inside them. A cycle a hand-edited file holds ends at the first repeat. */
export function heldIds(nodes: readonly ProjectNode[], items: readonly GroupItem[], groupIds: readonly string[]): Set<string> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const held = new Set<string>();

    const visit = (id: string): void => {
        const group = byId.get(id);

        if (group?.kind !== 'group') {
            return;
        }

        for (const member of groupMemberIds(group, items)) {
            if (!held.has(member) && !groupIds.includes(member)) {
                held.add(member);
                visit(member);
            }
        }
    };

    groupIds.forEach(visit);

    return held;
}

/* What the collapsed groups put out of sight, the groups inside them and what those hold included. */
export function hiddenIds(nodes: readonly ProjectNode[], items: readonly GroupItem[]): Set<string> {
    const hidden = new Set<string>();

    for (const group of nodes) {
        if (group.kind === 'group' && group.collapsed === true) {
            heldIds(nodes, items, [group.id]).forEach((id) => hidden.add(id));
        }
    }

    return hidden;
}

/*
 * The group a thing standing at `point` falls into, as a drop puts it there: the smallest open frame
 * under it, leaving out the ids in `excluded` (itself, what it holds, what is out of sight).
 */
export function groupUnder<T extends NodeRect & Pick<ProjectNode, 'id' | 'kind' | 'collapsed'>>(
    nodes: readonly T[],
    point: { x: number; y: number },
    excluded: ReadonlySet<string>
): T | null {
    let found: T | null = null;

    for (const node of nodes) {
        const inside = point.x >= node.x && point.x <= node.x + node.w && point.y >= node.y && point.y <= node.y + node.h;

        if (node.kind !== 'group' || node.collapsed === true || excluded.has(node.id) || !inside) {
            continue;
        }

        if (found === null || node.w * node.h < found.w * found.h) {
            found = node;
        }
    }

    return found;
}

/*
 * The nodes with `id` written into the group its center stands in and out of any other open group that
 * spells it out, the way a drop on the canvas puts it there. A group that still reads its members off
 * positions holds it, or lets it go, without being written.
 */
export function joinGroupUnder(canvas: Pick<ProjectCanvasView, 'nodes' | 'texts'>, id: string): ProjectNode[] {
    const node = canvas.nodes.find((candidate) => candidate.id === id);

    if (node === undefined) {
        return canvas.nodes;
    }

    const items = [...canvas.nodes, ...canvas.texts];
    const excluded = new Set([id, ...heldIds(canvas.nodes, items, [id]), ...hiddenIds(canvas.nodes, items)]);
    const target = groupUnder(canvas.nodes, { x: node.x + node.w / 2, y: node.y + node.h / 2 }, excluded);

    return canvas.nodes.map((candidate) => {
        if (candidate.kind !== 'group' || candidate.collapsed === true || !spellsOutMembers(candidate)) {
            return candidate;
        }

        const members = candidate.memberIds ?? [];
        const holds = members.includes(id);

        if (candidate.id === target?.id) {
            return holds ? candidate : withMemberIds(candidate, [...members, id]);
        }

        return holds && !excluded.has(candidate.id)
            ? withMemberIds(
                  candidate,
                  members.filter((member) => member !== id)
              )
            : candidate;
    });
}

/** Finds frames emptied by a deletion, including their empty parent frames. */
export function emptyCanvasGroupIds(canvas: Pick<ProjectCanvasView, 'nodes' | 'texts' | 'lines'>, removed: ReadonlySet<string>): string[] {
    const items: GroupItem[] = [
        ...canvas.nodes,
        ...canvas.texts,
        ...(canvas.lines ?? []).map((line) => ({
            id: line.id,
            x: (line.x + line.endX) / 2,
            y: (line.y + line.endY) / 2
        }))
    ];

    const groups = canvas.nodes.filter((node) => node.kind === 'group').map((group) => ({ id: group.id, members: groupMemberIds(group, items) }));
    const groupIds = new Set(groups.map((group) => group.id));
    const occupied = new Set(items.filter((item) => !groupIds.has(item.id) && !removed.has(item.id)).map((item) => item.id));
    const affected = new Set(removed);
    let changed = true;

    // Nested frames can contain each other's centers, so only a path to content keeps a frame occupied.
    while (changed) {
        changed = false;

        for (const group of groups) {
            if (removed.has(group.id)) {
                continue;
            }

            if (!occupied.has(group.id) && group.members.some((id) => occupied.has(id))) {
                occupied.add(group.id);
                changed = true;
            }

            if (!affected.has(group.id) && group.members.some((id) => affected.has(id))) {
                affected.add(group.id);
                changed = true;
            }
        }
    }

    return groups.filter((group) => !removed.has(group.id) && !occupied.has(group.id) && affected.has(group.id)).map((group) => group.id);
}
