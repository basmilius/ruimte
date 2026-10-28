import { COLUMN_W, GUTTER, LINE_H, OPEN_H, OPEN_MIN_H, STACK_GAP } from '@/canvas/beside-metrics';
import { GRID, snapToGrid, type Rect } from '@/canvas/math';
import type { CardSize } from '@/routines/output-size';

/* The column of phases is narrow and fixed, so it leaves the canvas beside the chat as free as it can. */
export const PHASES_W = 320;

export type WorkflowBesideCard =
    | { kind: 'summary'; key: 'summary'; rect: Rect }
    | { kind: 'phase'; key: string; phase: string; open: boolean; rect: Rect }
    | { kind: 'agent'; key: 'agent'; from: string; rect: Rect };

export interface WorkflowBesideView {
    /* Every phase's key, in the order the workflow shows them. */
    phases: readonly string[];
    /* The one phase that is open, or none. */
    openPhase: string | null;
    /* The phase of the agent whose conversation is open, or null with none open. */
    agentPhase: string | null;
}

export interface WorkflowBesideSizes {
    /* Each phase's header and agents as last measured open; one not measured yet starts at the minimum. */
    openHeights?: Readonly<Record<string, number>>;
    /* What a person gave the agent's card; null keeps the layout's. */
    agent?: CardSize | null;
}

export function phaseCardKey(phase: string): string {
    return `phase:${phase}`;
}

/*
 * Where the cards beside a chat node that runs a workflow go, in world units: a column to its right
 * with a line that sums the workflow up and a card per phase under it, at most one of them open; and,
 * only once a person picked an agent, a column right of that with the agent's conversation, its top
 * level with the node, as a routine's Output is. Sizes are known up front or measured once (the open
 * phase), so the lines and the culling place every card without measuring the rest.
 */
export function workflowBesideLayout(node: Rect, view: WorkflowBesideView, sizes: WorkflowBesideSizes = {}): WorkflowBesideCard[] {
    const { openHeights = {}, agent = null } = sizes;
    const x = node.x + node.w + GUTTER;
    const cards: WorkflowBesideCard[] = [{ kind: 'summary', key: 'summary', rect: { x, y: node.y, w: PHASES_W, h: LINE_H } }];
    let y = node.y + LINE_H + STACK_GAP;
    for (const phase of view.phases) {
        const open = phase === view.openPhase;
        const measured = openHeights[phase];
        const h = !open ? LINE_H : measured === undefined ? OPEN_MIN_H : Math.min(OPEN_H, Math.max(OPEN_MIN_H, Math.ceil(measured / GRID) * GRID));
        cards.push({ kind: 'phase', key: phaseCardKey(phase), phase, open, rect: { x, y, w: PHASES_W, h } });
        y += h + STACK_GAP;
    }
    if (view.agentPhase === null || !view.phases.includes(view.agentPhase)) {
        return cards;
    }
    cards.push({
        kind: 'agent',
        key: 'agent',
        // From its phase, open or not, so the line still says where the agent belongs once that phase closes.
        from: phaseCardKey(view.agentPhase),
        rect: { x: x + PHASES_W + GUTTER, y: node.y, w: snapToGrid(agent?.w ?? COLUMN_W), h: snapToGrid(agent?.h ?? OPEN_H) }
    });
    return cards;
}
