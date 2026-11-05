import { create } from 'zustand';
import type { SlotEntry } from '@/state/extension-registry';
import { useToasts } from '@/state/toasts';

export interface ActionRun {
    key: number;
    // The action this is, or null for work an extension marked itself.
    actionId: string | null;
    title: string;
    nodeIds: readonly string[];
    controller: AbortController;
}

export const useActionRuns = create<{ runs: readonly ActionRun[] }>(() => ({ runs: [] }));

let nextKey = 1;

/* Shows on the nodes it is about until the work is done, whichever surface started it. */
export async function trackRun<Result>(
    run: Pick<ActionRun, 'actionId' | 'title' | 'nodeIds'>,
    work: (signal: AbortSignal) => Result | Promise<Result>
): Promise<Result> {
    const key = nextKey;
    const controller = new AbortController();

    nextKey += 1;
    useActionRuns.setState(({ runs }) => ({ runs: [...runs, { ...run, key, controller }] }));

    try {
        return await work(controller.signal);
    } finally {
        useActionRuns.setState(({ runs }) => ({ runs: runs.filter((each) => each.key !== key) }));
    }
}

/* The same action may run on other nodes at once; only on one of the same nodes would it trip over itself. */
export function isRunning(runs: readonly ActionRun[], actionId: string, nodeIds: readonly string[]): boolean {
    return runs.some(
        (run) => run.actionId === actionId && (nodeIds.length === 0 || run.nodeIds.length === 0 || run.nodeIds.some((id) => nodeIds.includes(id)))
    );
}

export function nodeIdsOf(context: object): readonly string[] {
    const { nodes, node } = context as { nodes?: readonly { id: string }[]; node?: { id: string } };

    return (nodes ?? (node === undefined ? [] : [node])).map((each) => each.id);
}

/* An action is someone else's code and often slow, so a failure has to reach a person: nothing else is watching it. */
export function runAction(entry: Pick<SlotEntry, 'id' | 'title' | 'run' | 'onFailure'>, context: object, slot: string): Promise<void> {
    const nodeIds = nodeIdsOf(context);

    if (entry.run === undefined || isRunning(useActionRuns.getState().runs, entry.id, nodeIds)) {
        return Promise.resolve();
    }

    const { run } = entry;

    return trackRun({ actionId: entry.id, title: entry.title, nodeIds }, (signal) => run({ ...context, slot, signal })).catch((e: unknown) => {
        // A person stopping it is not a failure of the action.
        if (e instanceof DOMException && e.name === 'AbortError') {
            return;
        }

        const description = e instanceof Error ? e.message : String(e);

        useToasts.getState().show({ kind: 'error', title: entry.title, description });
        entry.onFailure?.(description);
    });
}
