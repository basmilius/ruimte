import type { ProjectView } from '@ruimte/contracts';
import { browserRegistry } from '@/browser/registry';
import { sessionNodesOf } from '@/project/project-sessions';
import { endpointKey } from '@/state/keys';
import { watchNodes, type NodeEnder } from '@/terminal/lifecycle-watch';
import { forgetScreen } from '@/terminal/registry';
import { browserClientFor, chatClientFor, sessionClientFor } from '@/transport/connections';

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
        void browserClientFor(endpointId)?.kill(id).catch(noop);
    }
};

/* Ends the daemon session of every node that leaves the document. The watching itself is testable on its own. */
export const startSessionLifecycle = (): (() => void) => watchNodes(end);

/*
 * Ends every session a project holds, on the machine that project was opened on. The watcher above
 * cannot do this: it skips a document that is swapping out, which is exactly what closing a project
 * looks like to it, and a switch to another project has to leave the sessions where they are.
 */
export const endProjectSessions = (endpointId: string, views: readonly ProjectView[]): void => {
    for (const node of sessionNodesOf(views)) {
        end(endpointId, node.id, node.kind);
    }
};
