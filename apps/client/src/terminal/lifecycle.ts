import type { CanvasNodeKind, ProjectView } from '@ruimte/contracts';
import { browserRegistry } from '@/browser/registry';
import { sessionNodesOf } from '@/project/project-sessions';
import { endpointKey } from '@/state/keys';
import { useChatTextSizes } from '@/state/chat-text-size';
import { watchNodes, type NodeExit } from '@/terminal/lifecycle-watch';
import { forgetScreen } from '@/terminal/registry';
import { browserClientFor, chatClientFor, sessionClientFor } from '@/transport/connections';

/* The node names the machine it ran on, so a node that leaves is ended there and not on the machine that is active now. */
function end(endpointId: string, id: string, kind: CanvasNodeKind, exit: NodeExit): void {
    useChatTextSizes.getState().reset(endpointKey(endpointId, id));
    if (kind === 'terminal') {
        forgetScreen(endpointId, id);
    } else if (kind === 'browser') {
        browserRegistry.destroy(endpointKey(endpointId, id));
    }
    if (exit !== 'closed') {
        return;
    }
    const client =
        kind === 'terminal'
            ? sessionClientFor(endpointId)
            : kind === 'chat'
              ? chatClientFor(endpointId)
              : kind === 'browser'
                ? browserClientFor(endpointId)
                : null;
    void client?.kill(id).catch(() => undefined);
}

/* Ends the daemon session of every node this client takes out of the document. */
export function startSessionLifecycle(): () => void {
    return watchNodes(end);
}

/*
 * What a closing project leaves behind inside this client. Ending the sessions themselves is the
 * daemon's: a project can be closed from a client that never had it on screen, and one that another
 * client still has open keeps its sessions running. The last screen of a terminal is a cache either
 * way, and a reattach fills it again.
 */
export function forgetProjectSessions(endpointId: string, views: readonly ProjectView[]): void {
    for (const node of sessionNodesOf(views)) {
        if (node.kind === 'terminal') {
            forgetScreen(endpointId, node.id);
        }
    }
}
