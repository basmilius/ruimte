import type { ChatState, ChatsById } from '@/state/chats';
import { endpointKey } from '@/state/keys';
import type { SessionState, SessionsByKey, StatusOf } from '@/state/sessions';

/*
 * Whether a session has an agent in the middle of a turn. Not `nodeStatus`: that calls a terminal
 * running the moment it is attached, which every open terminal is, so a shell waiting at its prompt
 * would count as work. A session counts only through the agent its hooks reported, and only while
 * that agent is `live`, since a record left behind by a CLI that went down with its shell keeps
 * whatever status it had. `needs-you` is a person's turn, not work.
 */
export const sessionWorking = (session: SessionState | undefined): boolean => session?.agent?.live === true && session.agent.status === 'running';

/* The same question of a chat, which carries the status on its thread rather than on a session. */
export const chatWorking = (chat: ChatState | undefined): boolean => chat?.info.status === 'running';

/* Whether any agent is working, over every machine this window is watching. */
export const agentsWorking = (sessions: SessionsByKey, chats: ChatsById): boolean =>
    Object.values(sessions).some(sessionWorking) || Object.values(chats).some(chatWorking);

/*
 * Whether this node is the one with the working agent in it. Only a terminal and a chat can be:
 * everything else on a canvas carries a status no CLI ever reported.
 */
export const nodeWorking = (node: StatusOf, sessions: SessionsByKey, chats: ChatsById, endpointId: string): boolean => {
    if (node.kind === 'terminal') {
        return sessionWorking(sessions[endpointKey(endpointId, node.id)]);
    }
    if (node.kind === 'chat') {
        return chatWorking(chats[endpointKey(endpointId, node.id)]);
    }
    return false;
};
