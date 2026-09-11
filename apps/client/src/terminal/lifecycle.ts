import { browserRegistry } from '@/browser/registry';
import { endpointKey } from '@/state/keys';
import { watchNodes, type NodeEnder } from '@/terminal/lifecycle-watch';
import { forgetScreen } from '@/terminal/registry';
import { chatClientFor, sessionClientFor } from '@/transport/connections';

const noop = (): void => undefined;

/* The node names the machine it ran on, so a node that leaves is ended there and not on the machine that is active now. */
const end: NodeEnder = (endpointId, id, kind) => {
    if (kind === 'terminal') {
        forgetScreen(endpointId, id);
        void sessionClientFor(endpointId)?.kill(id).catch(noop);
    } else if (kind === 'chat') {
        void chatClientFor(endpointId)?.kill(id).catch(noop);
    } else if (kind === 'browser') {
        browserRegistry.destroy(endpointKey(endpointId, id));
    }
};

/* Ends the daemon session of every node that leaves the document. The watching itself is testable on its own. */
export const startSessionLifecycle = (): (() => void) => watchNodes(end);
