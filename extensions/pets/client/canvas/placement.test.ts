import { describe, expect, test } from 'bun:test';
import type { NodeInfo } from '@ruimte/extension/client';
import { FOX_SPRITE, FROG_SPRITE } from '../animals';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '../buddies';
import { bubbleCell, PET_HEIGHT, petFrame } from '../pet-state';
import { BUBBLE_BESIDE, BUBBLE_ROWS, BUBBLE_SIZE, JUMP_ROWS, PAINT_COLUMNS, PAINT_ROWS } from '../pixel';
import { coversOtherNode, PET_HIT_HEIGHT, petBlocked, petBubbleBox, petCrowded, petHitBox, petNodeKey, petPlace, type PetNode } from './placement';

function info(id: string, kind: string, hidden = false): NodeInfo {
    return {
        id,
        kind,
        title: id,
        color: null,
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        groupId: null,
        hidden,
        viewId: 'main',
        machine: null,
        linkedTo: []
    };
}

function box(id: string, kind: string, at: Partial<PetNode> = {}): PetNode {
    return { id, kind, title: id, x: 0, y: 0, w: 400, h: 300, hidden: false, groupId: null, ...at };
}

function chatAt(id: string, y: number, at: Partial<PetNode> = {}): PetNode {
    return box(id, 'chat', { w: 480, y, ...at });
}

describe('which nodes have a pet', () => {
    test('a chat, a design and a terminal, and not a note', () => {
        expect(petNodeKey([info('writer', 'chat'), info('studio', 'design'), info('shell', 'terminal'), info('plan', 'note')])).toBe('writer\nstudio\nshell');
    });

    test('none for a node a collapsed group hides', () => {
        expect(petNodeKey([info('writer', 'chat', true)])).toBe('');
    });
});

describe('where a press on a pet lands', () => {
    test('on the figure, from the top edge of its node up to the top of its jump, and never on the bubble', () => {
        const node = { x: 100, y: 200, w: 400 };
        const hit = petHitBox(node);
        expect([hit.w, hit.h]).toEqual([52, PET_HIT_HEIGHT]);
        // The outline under its feet lies inside the node's frame, where a press starts a drag of the node.
        expect(hit.y + hit.h).toBe(200);
        // At the top of a jump the figure's third row, the first a body fills, is where the box begins.
        const jumpTop = petPlace(node).y + (BUBBLE_ROWS + JUMP_ROWS - JUMP_ROWS + 2) * 2;
        expect(hit.y).toBe(jumpTop);
        expect(hit.y).toBeGreaterThanOrEqual(petPlace(node).y + (BUBBLE_ROWS - 1) * 2);
    });

    test('a node 40 pixels under another, the gap new nodes get, keeps its pet off the one above', () => {
        const nodes = [chatAt('upper', 0), chatAt('lower', 340)];
        const hit = petHitBox(nodes[1]!);
        expect(hit.y - 300).toBe(2);
        expect(coversOtherNode(hit, 'lower', nodes)).toBe(false);
        expect([petBlocked(nodes, 'upper'), petBlocked(nodes, 'lower')]).toEqual([false, false]);
    });

    test('a pet whose figure stands on the node above leaves the press to that node', () => {
        const nodes = [chatAt('upper', 0), chatAt('lower', 310)];
        expect(petBlocked(nodes, 'lower')).toBe(true);
        expect(petBlocked(nodes, 'upper')).toBe(false);
    });

    test('the frame of a group the node does not stand in blocks it', () => {
        const above = box('above', 'group', { w: 600, h: 300 });
        expect(coversOtherNode(petHitBox(chatAt('lower', 310)), 'lower', [chatAt('lower', 310), above])).toBe(true);
        expect(coversOtherNode(petHitBox(chatAt('lower', 310)), 'lower', [chatAt('lower', 310, { groupId: 'above' }), above])).toBe(false);
    });

    test('a group the node stands in, or a node a collapsed group hides, does not block it', () => {
        const lower = chatAt('lower', 310);
        const group = box('team', 'group', { x: -40, y: -40, w: 600, h: 700 });
        expect(coversOtherNode(petHitBox(lower), 'lower', [lower, group])).toBe(false);
        expect(coversOtherNode(petHitBox(lower), 'lower', [lower, chatAt('upper', 0, { hidden: true })])).toBe(false);
    });
});

describe('where a waiting pet says so', () => {
    function overlaps(a: { x: number; y: number; w: number; h: number }, b: PetNode): boolean {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    test('a node 40 pixels above takes the space over its head, so the bubble goes beside it and never covers that node', () => {
        const upper = chatAt('upper', 0);
        const lower = chatAt('lower', 340);
        // Over its head, the bubble would lie on the bottom of the node above, at rest and higher in a jump.
        expect(overlaps(petBubbleBox(lower, 0, false), upper)).toBe(true);
        expect(petCrowded([upper, lower], 'lower')).toBe(true);
        for (const [mood, still] of [
            ['waiting', false],
            ['snoozed', false],
            ['waiting', true]
        ] as const) {
            for (let tick = 0; tick < 8; tick++) {
                const frame = petFrame(mood, tick, still);
                expect(frame.bubble).toBe(true);
                const bubble = petBubbleBox(lower, frame.lift, true);
                expect(overlaps(bubble, upper)).toBe(false);
                // Beside the pet it stays over the gap, off its own node too.
                expect(bubble.y + bubble.h).toBeLessThanOrEqual(lower.y);
            }
        }
    });

    test('with nothing over its head, or only a node a collapsed group hides, the bubble stays there', () => {
        expect(petCrowded([chatAt('upper', 0), chatAt('lower', 400)], 'lower')).toBe(false);
        expect(petCrowded([chatAt('lower', 340)], 'lower')).toBe(false);
        expect(petCrowded([chatAt('upper', 0, { hidden: true }), chatAt('lower', 340)], 'lower')).toBe(false);
    });

    test('beside a figure the bubble clears every built-in wait pose, and both places stay inside the paint', () => {
        for (const sprite of [CLAUDE_BUDDY, CODEX_BUDDY, FOX_SPRITE, FROG_SPRITE]) {
            for (let frame = 0; frame < 12; frame++) {
                const parts = sprite.poses.wait(frame);
                // A silhouette and an outlined prop get a rim of one cell.
                const right = [
                    ...parts.silhouette.map((part) => part.x + part.w + 1),
                    ...[...parts.details, ...parts.props].map((part) => part.x + part.w + (part.outlined ? 1 : 0))
                ];
                expect(Math.max(...right)).toBeLessThan(BUBBLE_BESIDE);
            }
        }
        for (let lift = 0; lift <= JUMP_ROWS; lift++) {
            for (const beside of [false, true]) {
                const at = bubbleCell(lift, beside);
                expect(at.x + BUBBLE_SIZE.columns).toBeLessThanOrEqual(PAINT_COLUMNS);
                expect(at.y).toBeGreaterThanOrEqual(0);
                expect(at.y + BUBBLE_SIZE.rows).toBeLessThanOrEqual(PAINT_ROWS);
            }
        }
    });
});

describe('where a pet stands', () => {
    test('on the top edge of its node, near the right corner, and inside a narrow one', () => {
        const place = petPlace({ x: 100, y: 200, w: 400 });
        expect(place.y + PET_HEIGHT).toBe(202);
        expect(place.x).toBe(100 + 400 - 52 - 24);
        expect(petPlace({ x: 100, y: 200, w: 40 }).x).toBe(100);
    });
});
