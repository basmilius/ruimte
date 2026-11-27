import { ToolRefusal } from '@adecore/agents/context';
import {
    NODE_SIZE_MAX,
    NODE_SIZE_MIN,
    PLACEMENT_GAP,
    gridSide,
    groupsGrownAround,
    heldIds,
    hiddenIds,
    isUnknownNode,
    joinGroup,
    joinGroupUnder,
    lineEndOf,
    rectBeside,
    rectsWithin,
    type GroupItem,
    type PlacementSide,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectNode
} from '@ruimte/contracts';
import { nodeLines } from './nodes.ts';
import { refuseMissingNodes } from './own-view.ts';
import { containersOf, type Rect } from './placement.ts';

const SIZE_LINES: readonly string[] = [`w\t${NODE_SIZE_MIN.w} to ${NODE_SIZE_MAX}`, `h\t${NODE_SIZE_MIN.h} to ${NODE_SIZE_MAX}`];

/* The size a call gave a node on top of the one it has, each side held to what a person can drag a frame to. */
export function sizeGiven(size: { w: number; h: number }, w: number | null | undefined, h: number | null | undefined): { w: number; h: number } {
    const side = (name: 'w' | 'h', value: number | null | undefined): number => {
        if (value == null) {
            return size[name];
        }

        const fitted = gridSide(value, NODE_SIZE_MIN[name]);

        if (fitted === null) {
            throw new ToolRefusal(
                'size-out-of-range',
                `${name} is ${value}; a node is ${NODE_SIZE_MIN[name]} to ${NODE_SIZE_MAX} ${name === 'w' ? 'wide' : 'high'}`,
                [...SIZE_LINES]
            );
        }

        return fitted;
    };

    return { w: side('w', w), h: side('h', h) };
}

/* A folded node and a collapsed group show their header alone, so a height is the one they open to again. */
export function resized(node: ProjectNode, w: number | null | undefined, h: number | null | undefined): ProjectNode {
    const folded = node.collapsed === true;
    const size = sizeGiven({ w: node.w, h: folded ? (node.expandedHeight ?? node.h) : node.h }, w, h);

    return folded ? { ...node, w: size.w, ...(h == null ? {} : { expandedHeight: size.h }) } : { ...node, ...size };
}

/* Everything on a canvas a group can hold; a drawn line counts by its middle, as the client reads it. */
function itemsOf(canvas: ProjectCanvasView): GroupItem[] {
    return [
        ...canvas.nodes,
        ...canvas.texts,
        ...(canvas.lines ?? []).map((line) => ({ id: line.id, x: (line.x + line.endX) / 2, y: (line.y + line.endY) / 2 }))
    ];
}

/* What moves when these nodes do: the nodes themselves and everything the groups among them hold. */
export function carriedBy(canvas: ProjectCanvasView, ids: readonly string[]): Set<string> {
    return new Set([...ids, ...heldIds(canvas.nodes, itemsOf(canvas), ids)]);
}

/* The canvas with a node at a new corner. A group takes along the nodes, texts and drawn lines it holds. */
export function movedTo(canvas: ProjectCanvasView, id: string, x: number, y: number): ProjectCanvasView {
    const node = canvas.nodes.find((candidate) => candidate.id === id);

    if (node === undefined || (node.x === x && node.y === y)) {
        return canvas;
    }

    const moving = carriedBy(canvas, [id]);
    const shift = { x: x - node.x, y: y - node.y };

    return {
        ...canvas,
        nodes: canvas.nodes.map((candidate) => (moving.has(candidate.id) ? { ...candidate, x: candidate.x + shift.x, y: candidate.y + shift.y } : candidate)),
        texts: canvas.texts.map((text) => (moving.has(text.id) ? { ...text, x: text.x + shift.x, y: text.y + shift.y } : text)),
        ...(canvas.lines === undefined
            ? {}
            : {
                  lines: canvas.lines.map((line) =>
                      moving.has(line.id) ? { ...line, x: line.x + shift.x, y: line.y + shift.y, endX: line.endX + shift.x, endY: line.endY + shift.y } : line
                  )
              })
    };
}

/* The node a side is a side of: the one the call named, else the caller's own node on this canvas. */
export function anchorOf(content: Pick<ProjectContent, 'views'>, canvas: ProjectCanvasView, caller: string, beside: string | null | undefined): ProjectNode {
    if (beside != null) {
        const named = canvas.nodes.find((node) => node.id === beside);

        if (named === undefined) {
            throw refuseMissingNodes(content, [beside], canvas.id, 'there is nothing there to stand beside', nodeLines(canvas));
        }

        return named;
    }

    const own = lineEndOf(canvas.nodes, caller);
    const self = canvas.nodes.find((node) => node.id === own);

    if (self === undefined) {
        throw new ToolRefusal('beside-required', `side is a side of you without beside, and you are no node on ${canvas.id}; name a node with beside`, [
            ...nodeLines(canvas)
        ]);
    }

    return self;
}

/* The frames a node stands in, from the one right around it outward. A cycle a hand-edited file holds ends at the first repeat. */
function framesAround(nodes: readonly ProjectNode[], id: string): Set<string> {
    const containers = containersOf(nodes);
    const around = new Set<string>();
    let frame = containers.get(id);

    while (frame !== undefined && !around.has(frame.id)) {
        around.add(frame.id);
        frame = containers.get(frame.id);
    }

    return around;
}

/*
 * Where a frame of `size` goes on a side of the anchor. Beside a node the call named it stands right
 * there, whatever is there already. Beside the caller it walks on in that direction past what is in
 * the way, since an agent that adds three nodes means a row; the frames around the caller are no
 * obstacle, and neither is `leaving`, which is what the call itself is moving.
 */
export function sideSpot(
    canvas: ProjectCanvasView,
    anchor: ProjectNode,
    size: { w: number; h: number },
    side: PlacementSide,
    options: { gap?: number | null; walk: boolean; leaving?: ReadonlySet<string> }
): Rect {
    const gap = options.gap ?? PLACEMENT_GAP;
    const spot = rectBeside(anchor, size, side, gap);

    if (!options.walk) {
        return spot;
    }

    const skipped = new Set([anchor.id, ...framesAround(canvas.nodes, anchor.id), ...hiddenIds(canvas.nodes, itemsOf(canvas)), ...(options.leaving ?? [])]);
    const obstacles = canvas.nodes.filter((node) => !skipped.has(node.id));

    for (;;) {
        const blocking = obstacles.filter((node) => rectsWithin(spot, node, gap));

        if (blocking.length === 0) {
            return spot;
        }

        if (side === 'right') {
            spot.x = Math.round(Math.max(...blocking.map((node) => node.x + node.w)) + gap);
        } else if (side === 'left') {
            spot.x = Math.round(Math.min(...blocking.map((node) => node.x)) - gap - size.w);
        } else if (side === 'below') {
            spot.y = Math.round(Math.max(...blocking.map((node) => node.y + node.h)) + gap);
        } else {
            spot.y = Math.round(Math.min(...blocking.map((node) => node.y)) - gap - size.h);
        }
    }
}

/* A node of a kind this machine does not know is written back as it was read, so a new place or size would never reach the file. */
export function refuseUnknownNode(node: ProjectNode): void {
    if (isUnknownNode(node)) {
        throw new ToolRefusal('unknown-node', `${node.id} is a node of a kind this machine does not know, so it cannot place it`);
    }
}

/* How a node this call changed finds its group: where it now stands, or with the node it was put beside. */
export interface Settling {
    readonly id: string;

    /** The anchor it was put beside, whose group it joins; null for a node that stays in the group it stands in. */
    readonly beside: string | null;

    /** Whether it moved, so it lands in the group under it the way a drop does. */
    readonly moved: boolean;
}

/*
 * The canvas once the nodes a call changed are in their groups, and those groups hold them. A node
 * that moved lands in the group under it as a drop puts it there; one put beside a node in a group
 * joins that group. Every frame around a changed node then grows until it holds it.
 */
export function settled(before: ProjectCanvasView, canvas: ProjectCanvasView, settlings: readonly Settling[]): ProjectCanvasView {
    const homes = new Map([...containersOf(before.nodes)].map(([id, group]) => [id, group.id]));
    let nodes = canvas.nodes;

    for (const { id, beside, moved } of settlings) {
        const group = beside === null ? undefined : containersOf(nodes).get(beside);

        if (group !== undefined) {
            nodes = joinGroup({ nodes, texts: canvas.texts }, id, group.id);
            homes.set(id, group.id);
            continue;
        }

        if (!moved) {
            continue;
        }

        nodes = joinGroupUnder({ nodes, texts: canvas.texts }, id);

        const home = containersOf(nodes).get(id);

        if (home === undefined) {
            homes.delete(id);
        } else {
            homes.set(id, home.id);
        }
    }

    return {
        ...canvas,
        nodes: groupsGrownAround(
            { nodes, texts: canvas.texts },
            settlings.map((settling) => settling.id),
            homes
        )
    };
}

/*
 * The pairs that overlap among what can be seen, each with a node this call moved or resized. A frame
 * overlaps what it holds by design, so groups are left out.
 */
export function overlapsOf(canvas: ProjectCanvasView, ids: readonly string[]): { nodeId: string; other: string }[] {
    const hidden = hiddenIds(canvas.nodes, itemsOf(canvas));
    const seen = canvas.nodes.filter((node) => node.kind !== 'group' && !hidden.has(node.id));
    const changed = carriedBy(canvas, ids);
    const pairs: { nodeId: string; other: string }[] = [];

    for (const [index, node] of seen.entries()) {
        for (const other of seen.slice(index + 1)) {
            if ((changed.has(node.id) || changed.has(other.id)) && rectsWithin(node, other, 0)) {
                pairs.push(changed.has(node.id) ? { nodeId: node.id, other: other.id } : { nodeId: other.id, other: node.id });
            }
        }
    }

    return pairs;
}
