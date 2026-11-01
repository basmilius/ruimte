import { create } from 'zustand';
import type { ActionContribution } from '@/extensions/registry';
import { useToasts } from '@/state/toasts';

export interface ActionRun {
    key: number;
    // The action this is, or null for work an extension marked itself.
    actionId: string | null;
    title: string;
    nodeIds: readonly string[];
}

export const useActionRuns = create<{ runs: readonly ActionRun[] }>(() => ({ runs: [] }));

let nextKey = 1;

/* Shows on the nodes it is about until the work is done, whichever surface started it. */
export async function trackRun<Result>(run: Omit<ActionRun, 'key'>, work: () => Result | Promise<Result>): Promise<Result> {
    const key = nextKey;

    nextKey += 1;
    useActionRuns.setState(({ runs }) => ({ runs: [...runs, { ...run, key }] }));

    try {
        return await work();
    } finally {
        useActionRuns.setState(({ runs }) => ({ runs: runs.filter((each) => each.key !== key) }));
    }
}

/* An action is someone else's code and often slow, so a failure has to reach a person: nothing else is watching it. */
export function runAction(action: ActionContribution, nodeIds: readonly string[]): void {
    if (useActionRuns.getState().runs.some((run) => run.actionId === action.id)) {
        return;
    }

    void trackRun({ actionId: action.id, title: action.title, nodeIds }, () => action.run(nodeIds)).catch((e: unknown) => {
        const description = e instanceof Error ? e.message : String(e);

        useToasts.getState().show({ kind: 'error', title: action.title, description });
        action.onFailure?.(description);
    });
}
