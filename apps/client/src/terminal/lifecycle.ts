import { chatClient } from '@/chat';
import { useCanvas } from '@/state/canvas';
import { sessionClient } from '@/terminal';
import { forgetScreen } from '@/terminal/registry';

/* Ends the daemon session of every terminal or chat node that leaves the store, so the store itself never talks to the transport. */
export const startSessionLifecycle = (): (() => void) => {
    let previous = useCanvas.getState().nodes;
    return useCanvas.subscribe((s) => {
        if (s.nodes === previous) {
            return;
        }
        const current = s.nodes;
        // Another project swapping in is not the person closing nodes; those sessions keep running.
        if (s.loading) {
            previous = current;
            return;
        }
        for (const [id, node] of Object.entries(previous)) {
            if (id in current) {
                continue;
            }
            if (node.kind === 'terminal') {
                forgetScreen(id);
                sessionClient.kill(id).catch(() => undefined);
            } else if (node.kind === 'chat') {
                chatClient.kill(id).catch(() => undefined);
            }
        }
        previous = current;
    });
};
