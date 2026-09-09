import { useCanvas } from '@/state/canvas';
import { sessionClient } from '@/terminal';
import { forgetScreen } from '@/terminal/registry';

/* Ends the daemon session of every terminal node that leaves the store, so the store itself never talks to the transport. */
export const startSessionLifecycle = (): (() => void) => {
    let previous = useCanvas.getState().nodes;
    return useCanvas.subscribe((s) => {
        if (s.nodes === previous) {
            return;
        }
        const current = s.nodes;
        for (const [id, node] of Object.entries(previous)) {
            if (node.kind === 'terminal' && !(id in current)) {
                forgetScreen(id);
                sessionClient.kill(id).catch(() => undefined);
            }
        }
        previous = current;
    });
};
