import { isChatNode } from '@ruimte/contracts';
import type { Rect } from '@/canvas/math';
import { bubbleCell, PET_HEIGHT, PET_WIDTH, samePet, WORLD_CELL, type AgentPet } from '@/pets/pet-state';
import { BUBBLE_SIZE, JUMP_ROWS, SPRITE_ROWS } from '@/pets/pixel';
import type { CanvasNode, CanvasState } from '@/state/canvas';

/* A pet and the node it stands on, kept together so one whose node was removed beams out where it stood (`useTeleport`). */
export interface Standing {
    node: CanvasNode;
    pet: AgentPet;
}

export function sameStanding(one: Standing, other: Standing): boolean {
    return one.node === other.node && samePet(one.pet, other.pet);
}

// The bottom row of a sprite is the outline under its feet, which lies on the node's top edge, inside its frame.
const FEET = WORLD_CELL;
const INSET = 24;

/*
 * The nodes that may have a pet, a chat, a design or a terminal no collapsed group hides, as one string: it
 * changes when one comes or goes and not on every frame of a drag, so the pets are not all drawn again.
 */
export function petNodeKey(s: Pick<CanvasState, 'nodes' | 'hidden'>): string {
    return Object.values(s.nodes)
        .filter((node) => (isChatNode(node) || node.kind === 'terminal') && !s.hidden.has(node.id))
        .map((node) => node.id)
        .join('\n');
}

/* Where a node's pet stands: on the top edge of its frame, near the right corner, clear of the title on the left. */
export function petPlace(node: Pick<CanvasNode, 'x' | 'y' | 'w'>): { x: number; y: number } {
    return { x: Math.max(node.x, node.x + node.w - PET_WIDTH - INSET), y: node.y - PET_HEIGHT + FEET };
}

/* Where a visitor stands beside a node: the same edge, near the left corner, where no pet of its own stands. */
export function visitorPlace(node: Pick<CanvasNode, 'x' | 'y'>): { x: number; y: number } {
    return { x: node.x + INSET, y: node.y - PET_HEIGHT + FEET };
}

/*
 * The rows a figure fills over its node, at rest and at the top of a jump: every row of a sprite but its
 * first two, which only a fox's ear tips and a sleeper's letters reach, and its last, the outline under
 * its feet inside the node's frame, where a press is the node's; and the rows it jumps into. The bubble
 * is paint and never takes a press. It stays clear of a node 40 pixels above, the gap new nodes get.
 */
export const PET_HIT_HEIGHT = (SPRITE_ROWS - 3 + JUMP_ROWS) * WORLD_CELL;

/* How far below the top of a pet's paint its press box begins. */
export const PET_HIT_TOP = PET_HEIGHT - FEET - PET_HIT_HEIGHT;

/* What a press on a figure standing here lands on: from its node's top edge up, wherever it is in a jump. */
export function hitBoxAt(place: { x: number; y: number }): Rect {
    return { x: place.x, y: place.y + PET_HIT_TOP, w: PET_WIDTH, h: PET_HIT_HEIGHT };
}

export function petHitBox(node: Pick<CanvasNode, 'x' | 'y' | 'w'>): Rect {
    return hitBoxAt(petPlace(node));
}

/* What a node's pet's bubble covers on the canvas at a lift. */
export function petBubbleBox(node: Pick<CanvasNode, 'x' | 'y' | 'w'>, lift: number, beside: boolean): Rect {
    const place = petPlace(node);
    const at = bubbleCell(lift, beside);
    return { x: place.x + at.x * WORLD_CELL, y: place.y + at.y * WORLD_CELL, w: BUBBLE_SIZE.columns * WORLD_CELL, h: BUBBLE_SIZE.rows * WORLD_CELL };
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/*
 * Whether a box over the canvas lies on another node a person can see. A group the node stands in does
 * not count, as a member or inside its frame: it is a frame under its own nodes, and a pet of a node
 * in one always stands on it. Any other group's frame does.
 */
export function coversOtherNode(box: Rect, ownId: string, nodes: Readonly<Record<string, CanvasNode>>, hidden: ReadonlySet<string>): boolean {
    const own = nodes[ownId];
    const holdsOwn = (group: CanvasNode): boolean => group.memberIds?.includes(ownId) === true || (own !== undefined && contains(group, own));
    return Object.values(nodes).some(
        (other) => other.id !== ownId && !hidden.has(other.id) && !(other.kind === 'group' && holdsOwn(other)) && overlaps(box, other)
    );
}

/*
 * Whether a node's pet stands over another node, where a press belongs to that node and not to the pet.
 * A boolean, so a pet that selects it is drawn again only when it flips, not on every frame of a drag.
 */
export function petBlocked(s: Pick<CanvasState, 'nodes' | 'hidden'>, id: string): boolean {
    const node = s.nodes[id];
    return node !== undefined && coversOtherNode(petHitBox(node), id, s.nodes, s.hidden);
}

/* Whether another node lies where the bubble over a pet's head goes, anywhere in its jump, so it goes beside the pet. */
export function petCrowded(s: Pick<CanvasState, 'nodes' | 'hidden'>, id: string): boolean {
    const node = s.nodes[id];
    if (node === undefined) {
        return false;
    }
    const top = petBubbleBox(node, JUMP_ROWS, false);
    const rest = petBubbleBox(node, 0, false);
    return coversOtherNode({ ...top, h: rest.y + rest.h - top.y }, id, s.nodes, s.hidden);
}
