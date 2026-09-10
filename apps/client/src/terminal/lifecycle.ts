import { browserRegistry } from '@/browser/registry';
import { chatClient } from '@/chat';
import { sessionClient } from '@/terminal';
import { watchNodes, type NodeEnder } from '@/terminal/lifecycle-watch';
import { forgetScreen } from '@/terminal/registry';

const end: NodeEnder = (id, kind) => {
    if (kind === 'terminal') {
        forgetScreen(id);
        sessionClient.kill(id).catch(() => undefined);
    } else if (kind === 'chat') {
        chatClient.kill(id).catch(() => undefined);
    } else if (kind === 'browser') {
        browserRegistry.destroy(id);
    }
};

/* Ends the daemon session of every node that leaves the document. The watching itself is testable on its own. */
export const startSessionLifecycle = (): (() => void) => watchNodes(end);
