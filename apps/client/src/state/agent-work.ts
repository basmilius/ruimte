import type { ChatState, ChatStatuses } from '@adecore/agents-react/state';
import { endpointKey, endpointOfNode } from '@/state/keys';
import type { SessionState, SessionsByKey, StatusOf } from '@/state/sessions';

/*
 * Whether a session has an agent in the middle of a turn. Not `nodeStatus`, which calls every attached
 * terminal running. Only a `live` agent counts, since a record left by a CLI that went down with its
 * shell keeps whatever status it had. `needs-you` is a person's turn, not work.
 */
export function sessionWorking(session: SessionState | undefined): boolean {
    return session?.agent?.live === true && session.agent.status === 'running';
}

/* The same question of a chat, which carries the status on its thread rather than on a session. */
export function chatWorking(chat: Pick<ChatState, 'info'> | undefined): boolean {
    return chat?.info.status === 'running';
}

/* A chat between turns whose CLI still runs subagents or a workflow in the background. Waiting on a person outranks it. */
function chatDelegating(chat: Pick<ChatState, 'info'> | undefined): boolean {
    return chat?.info.status === 'idle' && chat.info.delegating === true;
}

/* Whether any agent is working, over every machine this window is watching. */
export function agentsWorking(sessions: SessionsByKey, chats: ChatStatuses): boolean {
    return Object.values(sessions).some(sessionWorking) || Object.values(chats).some((chat) => chatWorking(chat) || chatDelegating(chat));
}

/* A turn of the node's own agent, or only the subagents it left running, which a node draws in gray. */
export type AgentWork = 'turn' | 'delegating';

/*
 * What the agent in this node is working on, if anything. Only a terminal and a chat can say,
 * since everything else on a canvas carries a status no CLI ever reported.
 */
export function nodeWork(node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): AgentWork | null {
    const machine = endpointOfNode(node, endpointId);
    if (node.kind === 'terminal') {
        return sessionWorking(sessions[endpointKey(machine, node.id)]) ? 'turn' : null;
    }
    // A design node works as the chat under its own id; its later chats count as chats of their own.
    if (node.kind !== 'chat' && node.kind !== 'design') {
        return null;
    }
    const chat = chats[endpointKey(machine, node.id)];
    if (chatWorking(chat)) {
        return 'turn';
    }
    return chatDelegating(chat) ? 'delegating' : null;
}

/* Whether this node has an agent at work in it, its own turn or only its subagents. */
export function nodeWorking(node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): boolean {
    return nodeWork(node, sessions, chats, endpointId) !== null;
}
