import type { ChatClient } from '@adecore/agents-react/chat';
import { ActionRefusal } from '@ruimte/actions';
import { endpointOfNodeId } from '@/state/node-endpoint';
import type { SessionClient } from '@/terminal/session-client';
import { chatClientFor, sessionClientFor } from '@/transport/connections';

function unknownMachine(nodeId: string): ActionRefusal {
    return new ActionRefusal('no-machine', `“${nodeId}” runs on a machine this client does not know, so nothing was sent.`);
}

/* The chats of the machine a node runs on. A machine this client has no row for refuses, so nothing lands on the active machine. */
export function chatClientOfNode(nodeId: string): ChatClient {
    const chats = chatClientFor(endpointOfNodeId(nodeId));
    if (chats === null) {
        throw unknownMachine(nodeId);
    }
    return chats;
}

/* The sessions of the machine a node runs on, refused the same way. */
export function sessionClientOfNode(nodeId: string): SessionClient {
    const sessions = sessionClientFor(endpointOfNodeId(nodeId));
    if (sessions === null) {
        throw unknownMachine(nodeId);
    }
    return sessions;
}
