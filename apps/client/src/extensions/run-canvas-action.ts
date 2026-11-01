import type { CanvasActionContribution } from '@/extensions/registry';
import { useToasts } from '@/state/toasts';

/* An action is someone else's code and often slow, so a failure has to reach a person: nothing else is watching it. */
export function runCanvasAction(action: CanvasActionContribution, selection: readonly string[]): void {
    void (async () => action.run(selection))().catch((e: unknown) => {
        useToasts.getState().show({ kind: 'error', title: action.title, description: e instanceof Error ? e.message : String(e) });
    });
}
