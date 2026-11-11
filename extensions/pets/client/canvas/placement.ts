import type { NodeInfo } from '@ruimte/extension/client';
import { bubbleCell, PET_HEIGHT, PET_WIDTH, samePet, WORLD_CELL, type AgentPet } from '../pet-state';
import { BUBBLE_SIZE, JUMP_ROWS, SPRITE_ROWS } from '../pixel';

/* A box on the canvas, in its own coordinates. */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/* A node as a pet measures it: where it stands, and what may hide it or hold it. */
export interface PetNode extends Rect {
    id: string;
    kind: string;
    title: string;
    hidden: boolean;
    groupId: string | null;
}

export function petNodeOf(info: NodeInfo): PetNode {
    const { x, y, width, height } = info.bounds;

    return { id: info.id, kind: info.kind, title: info.title, x, y, w: width, h: height, hidden: info.hidden, groupId: info.groupId };
}

/* A pet and the node it stands on, kept together so one whose node was removed beams out where it stood (`useTeleport`). */
export interface Standing {
    node: NodeInfo;
    pet: AgentPet;
}

export function sameStanding(one: Standing, other: Standing): boolean {
    return one.node === other.node && samePet(one.pet, other.pet);
}

// The bottom row of a sprite is the outline under its feet, which lies on the node's top edge, inside its frame.
const FEET = WORLD_CELL;
const INSET = 24;

/* The kinds that have an agent of their own: a chat, a design (which works as the chat under its own id) and a terminal. */
export function mayHavePet(node: Pick<NodeInfo, 'kind'>): boolean {
    return node.kind === 'chat' || node.kind === 'design' || node.kind === 'terminal';
}

/*
 * The nodes that may have a pet, a chat, a design or a terminal no collapsed group hides, as one string: it
 * changes when one comes or goes and not on every frame of a drag, so the pets are not all drawn again.
 */
export function petNodeKey(nodes: readonly NodeInfo[]): string {
    return nodes
        .filter((node) => mayHavePet(node) && !node.hidden)
        .map((node) => node.id)
        .join('\n');
}

/* Where a node's pet stands: on the top edge of its frame, near the right corner, clear of the title on the left. */
export function petPlace(node: Pick<Rect, 'x' | 'y' | 'w'>): { x: number; y: number } {
    return { x: Math.max(node.x, node.x + node.w - PET_WIDTH - INSET), y: node.y - PET_HEIGHT + FEET };
}

/* Where a visitor stands beside a node: the same edge, near the left corner, where no pet of its own stands. */
export function visitorPlace(node: Pick<Rect, 'x' | 'y'>): { x: number; y: number } {
    return { x: node.x + INSET, y: node.y - PET_HEIGHT + FEET };
}

/*
 * The rows a figure fills over its node, at rest and at the top of a jump: every row of a sprite but its
 * first two, which only a fox's ear tips and a sleeper's letters reach, and its last, the outline under
 * its feet inside the node's frame, where a press is the node's; and the rows it jumps into. The bubble
 * is paint and never takes a press. It stays clear of a node 40 pixels above, the gap new nodes get.
 */
export const PET_HIT_HEIGHT = (SPRITE_ROWS - 3 + JUMP_ROWS) * WORLD_CELL;

export const PET_HIT_TOP = PET_HEIGHT - FEET - PET_HIT_HEIGHT;

/* What a press on a figure standing here lands on: from its node's top edge up, wherever it is in a jump. */
export function hitBoxAt(place: { x: number; y: number }): Rect {
    return { x: place.x, y: place.y + PET_HIT_TOP, w: PET_WIDTH, h: PET_HIT_HEIGHT };
}

export function petHitBox(node: Pick<Rect, 'x' | 'y' | 'w'>): Rect {
    return hitBoxAt(petPlace(node));
}

export function petBubbleBox(node: Pick<Rect, 'x' | 'y' | 'w'>, lift: number, beside: boolean): Rect {
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
export function coversOtherNode(box: Rect, ownId: string, nodes: readonly PetNode[]): boolean {
    const own = nodes.find((node) => node.id === ownId);
    const holdsOwn = (group: PetNode): boolean => own !== undefined && (own.groupId === group.id || contains(group, own));
    return nodes.some((other) => other.id !== ownId && !other.hidden && !(other.kind === 'group' && holdsOwn(other)) && overlaps(box, other));
}

/* Whether a node's pet stands over another node, where a press belongs to that node and not to the pet. */
export function petBlocked(nodes: readonly PetNode[], id: string): boolean {
    const node = nodes.find((each) => each.id === id);
    return node !== undefined && coversOtherNode(petHitBox(node), id, nodes);
}

/* Whether another node lies where the bubble over a pet's head goes, anywhere in its jump, so it goes beside the pet. */
export function petCrowded(nodes: readonly PetNode[], id: string): boolean {
    const node = nodes.find((each) => each.id === id);
    if (node === undefined) {
        return false;
    }
    const top = petBubbleBox(node, JUMP_ROWS, false);
    const rest = petBubbleBox(node, 0, false);
    return coversOtherNode({ ...top, h: rest.y + rest.h - top.y }, id, nodes);
}
