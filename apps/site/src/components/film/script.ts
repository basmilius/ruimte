import type { AgentStatus } from '../app/canvas.tsx';
import type { Rect } from '../app/edge-route.ts';

// The film's script: how long each step of a chapter lasts and who has which status when.

// ask, answer, tools, browser, waiting, click, committed (held)
export const CANVAS_STEPS = [1000, 2600, 1500, 1500, 2200, 1300, 2600] as const;

export function chatStatus(step: number): AgentStatus {
    if (step === 4 || step === 5) {
        return 'needs-you';
    }
    return step >= 6 ? 'idle' : 'running';
}

// one view, two cells, four cells, working, focus moves (held)
export const GRID_STEPS = [1100, 1300, 1300, 3400, 2200] as const;

// ask, plan, start, work, first done, second, third and wake, merged (held)
export const DELEGATE_STEPS = [900, 2200, 1300, 2200, 1200, 1200, 2400, 2600] as const;

export interface Child {
    readonly id: string;
    readonly task: string;
    readonly tool: string;
    readonly rect: Rect;
    /** The step its task settles on. */
    readonly doneAt: number;
}

export const CHILDREN: readonly Child[] = [
    { id: 'tokens', task: 'Move every color to a semantic token', tool: 'src/styles/tokens.css', rect: { x: 540, y: 36, w: 440, h: 168 }, doneAt: 4 },
    { id: 'components', task: 'Switch the components to the tokens', tool: 'src/components/Button.tsx', rect: { x: 540, y: 236, w: 440, h: 168 }, doneAt: 6 },
    { id: 'tests', task: 'Snapshot every screen in both themes', tool: 'tests/themes.test.ts', rect: { x: 540, y: 436, w: 440, h: 168 }, doneAt: 5 }
];

export function leadStatus(step: number): AgentStatus {
    if (step >= 7) {
        return 'idle';
    }
    return step >= 3 && step < 6 ? 'idle' : 'running';
}

export function childStatus(child: Child, step: number): AgentStatus {
    return step >= child.doneAt ? 'idle' : 'running';
}
