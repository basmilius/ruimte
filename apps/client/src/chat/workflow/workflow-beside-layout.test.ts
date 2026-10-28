import { describe, expect, test } from 'bun:test';
import { COLUMN_W, GUTTER, LINE_H, OPEN_H, OPEN_MIN_H, STACK_GAP } from '@/canvas/beside-metrics';
import { GRID } from '@/canvas/math';
import { PHASES_W, workflowBesideLayout, type WorkflowBesideCard } from '@/chat/workflow/workflow-beside-layout';

const NODE = { x: 100, y: 200, w: 480, h: 640 };
const PHASES = ['loose', 'phase-1', 'phase-2'];

function cardOf(cards: WorkflowBesideCard[], key: string): WorkflowBesideCard {
    return cards.find((card) => card.key === key)!;
}

describe('workflowBesideLayout', () => {
    test('stands a summary and a card per phase in a column right of the node, collapsed ones a line high', () => {
        const cards = workflowBesideLayout(NODE, { phases: PHASES, openPhase: null, agentPhase: null });
        expect(cards.map((card) => card.key)).toEqual(['summary', 'phase:loose', 'phase:phase-1', 'phase:phase-2']);
        const x = NODE.x + NODE.w + GUTTER;
        expect(cards.every((card) => card.rect.x === x && card.rect.w === PHASES_W)).toBe(true);
        expect(cards.map((card) => card.rect.y)).toEqual([200, 200 + LINE_H + STACK_GAP, 200 + 2 * (LINE_H + STACK_GAP), 200 + 3 * (LINE_H + STACK_GAP)]);
        expect(cards.every((card) => card.rect.h === LINE_H)).toBe(true);
    });

    test('opens one phase at its measured height, kept between the minimum and the maximum, and moves the rest down', () => {
        const unmeasured = workflowBesideLayout(NODE, { phases: PHASES, openPhase: 'phase-1', agentPhase: null });
        expect(cardOf(unmeasured, 'phase:phase-1')).toMatchObject({ open: true, rect: { h: OPEN_MIN_H } });
        expect(cardOf(unmeasured, 'phase:loose')).toMatchObject({ open: false });

        const tall = workflowBesideLayout(NODE, { phases: PHASES, openPhase: 'phase-1', agentPhase: null }, { openHeights: { 'phase-1': 2000 } });
        expect(cardOf(tall, 'phase:phase-1').rect.h).toBe(OPEN_H);
        expect(cardOf(tall, 'phase:phase-2').rect.y).toBe(cardOf(tall, 'phase:phase-1').rect.y + OPEN_H + STACK_GAP);

        // Measured in pixels, laid out on the grid.
        const between = workflowBesideLayout(NODE, { phases: PHASES, openPhase: 'phase-1', agentPhase: null }, { openHeights: { 'phase-1': 201 } });
        expect(cardOf(between, 'phase:phase-1').rect.h % GRID).toBe(0);
        expect(cardOf(between, 'phase:phase-1').rect.h).toBeGreaterThanOrEqual(201);
    });

    test("an agent's card stands only once one is picked, level with the node, with its line from its phase even when that phase is closed", () => {
        expect(workflowBesideLayout(NODE, { phases: PHASES, openPhase: 'phase-1', agentPhase: null }).some((card) => card.kind === 'agent')).toBe(false);
        const cards = workflowBesideLayout(NODE, { phases: PHASES, openPhase: null, agentPhase: 'phase-2' });
        expect(cardOf(cards, 'agent')).toEqual({
            kind: 'agent',
            key: 'agent',
            from: 'phase:phase-2',
            rect: { x: NODE.x + NODE.w + GUTTER + PHASES_W + GUTTER, y: NODE.y, w: COLUMN_W, h: OPEN_H }
        });
        // An agent of a phase the workflow no longer shows has no card.
        expect(workflowBesideLayout(NODE, { phases: PHASES, openPhase: null, agentPhase: 'phase-9' }).some((card) => card.kind === 'agent')).toBe(false);
    });

    test("the agent's card keeps the size a person gave it", () => {
        const cards = workflowBesideLayout(NODE, { phases: PHASES, openPhase: null, agentPhase: 'loose' }, { agent: { w: 600, h: 320 } });
        expect(cardOf(cards, 'agent').rect).toMatchObject({ w: 600, h: 320 });
    });
});
