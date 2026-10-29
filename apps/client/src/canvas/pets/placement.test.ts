import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { ChatState } from '@adecore/agents-react/state';
import { coversOtherNode, PET_HIT_HEIGHT, petBlocked, petBubbleBox, petCrowded, petHitBox, petNodeKey, petPlace } from '@/canvas/pets/placement';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/pets/animals';
import { BUBBLE_BESIDE, BUBBLE_ROWS, BUBBLE_SIZE, JUMP_ROWS, PAINT_COLUMNS, PAINT_ROWS } from '@/pets/pixel';
import { bubbleCell, PET_HEIGHT, petFrame, petOf } from '@/pets/pet-state';
import type { CanvasNode } from '@/state/canvas';
import type { SessionsByKey, SessionState } from '@/state/sessions';
import type { Snoozes } from '@/state/snooze';
import type { ChatStatuses } from '@adecore/agents-react/state';
import { chatInfoOf } from '../../../testing/chat-info';

function agent(status: AgentStatus, kind = 'claude'): AgentInfo {
    return { kind, agentSessionId: 'a1', transcriptPath: null, status, live: true, updatedAt: 0 };
}

function session(info?: AgentInfo): SessionState {
    return { attached: true, agent: info };
}

function chat(id: string, status: AgentStatus, provider = 'claude'): ChatState {
    return { info: chatInfoOf(id, { status, provider }), items: {}, structure: {}, order: [] };
}

function node(id: string, kind: CanvasNode['kind']): CanvasNode {
    return { id, kind, x: 0, y: 0, w: 400, h: 300 } as CanvasNode;
}

const NODES: Record<string, CanvasNode> = {
    writer: node('writer', 'chat'),
    shell: node('shell', 'terminal'),
    agent: node('agent', 'terminal'),
    plan: node('plan', 'note')
};

function chatAt(id: string, y: number): CanvasNode {
    return { id, kind: 'chat', x: 0, y, w: 480, h: 300 } as CanvasNode;
}

/* The pets the layer draws: one for each node the key names that has an agent in it. */
function petsOf(nodes: Record<string, CanvasNode>, hidden: Set<string>, sessions: SessionsByKey, chats: ChatStatuses, snoozes: Snoozes) {
    const key = petNodeKey({ nodes, hidden });
    return (key === '' ? [] : key.split('\n')).flatMap((id) => {
        const pet = petOf(nodes[id], sessions, chats, 'local', snoozes);
        return pet === null ? [] : [{ id, ...pet }];
    });
}

describe('which nodes have a pet', () => {
    test('a chat and a terminal with an agent in it, and not a bare shell or a note', () => {
        const pets = petsOf(
            NODES,
            new Set(),
            { 'local:shell': session(), 'local:agent': session(agent('idle', 'codex')) },
            { 'local:writer': chat('writer', 'idle') },
            {}
        );
        expect(pets.map((pet) => [pet.id, pet.agent])).toEqual([
            ['writer', 'claude'],
            ['agent', 'codex']
        ]);
    });

    test('none for a node a collapsed group hides', () => {
        expect(petsOf(NODES, new Set(['writer']), {}, { 'local:writer': chat('writer', 'idle') }, {})).toEqual([]);
    });

    test('a design, through the chat under its own id, as its status dot reads it', () => {
        const nodes = { studio: node('studio', 'design') };
        const pet = (status: AgentStatus) => petsOf(nodes, new Set(), {}, { 'local:studio': chat('studio', status, 'codex') }, {});
        expect(pet('idle')).toEqual([{ id: 'studio', agent: 'codex', mood: 'idle' }]);
        expect(pet('running')[0].mood).toBe('working');
        expect(pet('needs-you')[0].mood).toBe('waiting');
        expect(petsOf(nodes, new Set(['studio']), {}, { 'local:studio': chat('studio', 'idle') }, {})).toEqual([]);
    });
});

describe('where a press on a pet lands', () => {
    test('on the figure, from the top edge of its node up to the top of its jump, and never on the bubble', () => {
        const node = { x: 100, y: 200, w: 400 };
        const box = petHitBox(node);
        expect([box.w, box.h]).toEqual([52, PET_HIT_HEIGHT]);
        // The outline under its feet lies inside the node's frame, where a press starts a drag of the node.
        expect(box.y + box.h).toBe(200);
        // At the top of a jump the figure's third row, the first a body fills, is where the box begins.
        const jumpTop = petPlace(node).y + (BUBBLE_ROWS + JUMP_ROWS - JUMP_ROWS + 2) * 2;
        expect(box.y).toBe(jumpTop);
        // The bubble sits in the rows above it.
        expect(box.y).toBeGreaterThanOrEqual(petPlace(node).y + (BUBBLE_ROWS - 1) * 2);
    });

    test('a node 40 pixels under another, the gap new nodes get, keeps its pet off the one above', () => {
        const nodes = { upper: chatAt('upper', 0), lower: chatAt('lower', 340) };
        const box = petHitBox(nodes.lower);
        expect(box.y - (nodes.upper.y + nodes.upper.h)).toBe(2);
        expect(coversOtherNode(box, 'lower', nodes, new Set())).toBe(false);
        expect([petBlocked({ nodes, hidden: new Set() }, 'upper'), petBlocked({ nodes, hidden: new Set() }, 'lower')]).toEqual([false, false]);
    });

    test('a pet whose figure stands on the node above leaves the press to that node', () => {
        const nodes = { upper: chatAt('upper', 0), lower: chatAt('lower', 310) };
        expect(petBlocked({ nodes, hidden: new Set() }, 'lower')).toBe(true);
        expect(petBlocked({ nodes, hidden: new Set() }, 'upper')).toBe(false);
    });

    test('the frame of a group the node does not stand in blocks it', () => {
        const lower = chatAt('lower', 310);
        const above = { id: 'above', kind: 'group', x: 0, y: 0, w: 600, h: 300 } as CanvasNode;
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, above }, new Set())).toBe(true);
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, above: { ...above, memberIds: ['lower'] } }, new Set())).toBe(false);
    });

    test('a group the node stands in, or a node a collapsed group hides, does not block it', () => {
        const lower = chatAt('lower', 310);
        const group = { id: 'team', kind: 'group', x: -40, y: -40, w: 600, h: 700 } as CanvasNode;
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, team: group }, new Set())).toBe(false);
        expect(coversOtherNode(petHitBox(lower), 'lower', { lower, upper: chatAt('upper', 0) }, new Set(['upper']))).toBe(false);
    });
});

describe('where a waiting pet says so', () => {
    function overlaps(a: { x: number; y: number; w: number; h: number }, b: CanvasNode): boolean {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    test('a node 40 pixels above takes the space over its head, so the bubble goes beside it and never covers that node', () => {
        const nodes = { upper: chatAt('upper', 0), lower: chatAt('lower', 340) };
        // Over its head, the bubble would lie on the bottom of the node above, at rest and higher in a jump.
        expect(overlaps(petBubbleBox(nodes.lower, 0, false), nodes.upper)).toBe(true);
        expect(petCrowded({ nodes, hidden: new Set() }, 'lower')).toBe(true);
        for (const [mood, still] of [
            ['waiting', false],
            ['snoozed', false],
            ['waiting', true]
        ] as const) {
            for (let tick = 0; tick < 8; tick++) {
                const frame = petFrame(mood, tick, still);
                expect(frame.bubble).toBe(true);
                const box = petBubbleBox(nodes.lower, frame.lift, true);
                expect(overlaps(box, nodes.upper)).toBe(false);
                // Beside the pet it stays over the gap, off its own node too.
                expect(box.y + box.h).toBeLessThanOrEqual(nodes.lower.y);
            }
        }
    });

    test('with nothing over its head, or only a node a collapsed group hides, the bubble stays there', () => {
        const nodes = { upper: chatAt('upper', 0), lower: chatAt('lower', 400) };
        expect(petCrowded({ nodes, hidden: new Set() }, 'lower')).toBe(false);
        expect(petCrowded({ nodes: { lower: chatAt('lower', 340) }, hidden: new Set() }, 'lower')).toBe(false);
        expect(petCrowded({ nodes: { upper: nodes.upper, lower: chatAt('lower', 340) }, hidden: new Set(['upper']) }, 'lower')).toBe(false);
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
