import type { ChatState, ChatStatuses } from '@adecore/agents-react/state';
import { chatActivity } from '@ruimte/contracts';
import { openChildTasks } from '@/state/delegation';
import { endpointKey, endpointOfNode } from '@/state/keys';
import type { SessionState, SessionsByKey, StatusOf } from '@/state/sessions';
import type { TasksById } from '@/state/tasks';

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
    return chat !== undefined && chatActivity(chat.info) === 'working';
}

/* A chat between turns whose CLI still runs subagents or a workflow in the background. Waiting on a person outranks it. */
function chatDelegating(chat: Pick<ChatState, 'info'> | undefined): boolean {
    return chat !== undefined && chatActivity(chat.info) === 'delegating';
}

/*
 * The same, widened by what a node shows: a child agent it gave a task still open, and below that a
 * command or monitor left running. Not for staying awake, since a dev server in the background never ends.
 */
function chatWaitsOnWork(chat: Pick<ChatState, 'info'> | undefined, openChildren: number): AgentWork | null {
    if (chat?.info.status !== 'idle') {
        return null;
    }

    const activity = chatActivity(chat.info);

    if (activity === 'delegating' || openChildren > 0) {
        return 'delegating';
    }

    return activity === 'background' ? 'background' : null;
}

export function agentsWorking(sessions: SessionsByKey, chats: ChatStatuses): boolean {
    return Object.values(sessions).some(sessionWorking) || Object.values(chats).some((chat) => chatWorking(chat) || chatDelegating(chat));
}

/*
 * A turn of the node's own agent, agents it left working (drawn in gray), or only commands and monitors
 * it left running, which a node marks with their own icon since no agent works on them.
 */
export type AgentWork = 'turn' | 'delegating' | 'background';

/*
 * What the agent in this node is working on, if anything. Only a terminal and a chat can say,
 * since everything else on a canvas carries a status no CLI ever reported. `tasks` are those of the
 * node's machine; without them a child agent it delegated to does not count.
 */
export function nodeWork(node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string, tasks?: TasksById): AgentWork | null {
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
    return chatWaitsOnWork(chat, openChildTasks(tasks, node.id).length);
}

export function nodeWorking(node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): boolean {
    return nodeWork(node, sessions, chats, endpointId) !== null;
}
