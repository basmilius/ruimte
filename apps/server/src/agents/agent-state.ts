import type { AgentStateHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { OutboxStore } from '../outbox/outbox.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { AgentLineageStore } from './lineage.ts';

export interface AgentStateSources {
    outbox: Pick<OutboxStore, 'list'>;
    lineage: Pick<AgentLineageStore, 'endedAt'>;
    chats: Pick<ChatManager, 'get' | 'hasStored' | 'cancel' | 'lastTurn'>;
    sessions: Pick<SessionManager, 'get'>;
}

/*
 * Reads an agent node's state off what the daemon already keeps for it, so an operation has no store
 * of its own: the outbox owes its start, the chat or the terminal says what it does, and the lineage
 * says whether ending the node that opened it ended it too.
 */
export const agentStates = (sources: AgentStateSources): AgentStateHost => ({
    stateOf: async (nodeId) => {
        if (sources.outbox.list().some((entry) => entry.kind === 'start-agent' && entry.target === nodeId)) {
            return 'owed';
        }
        if (sources.lineage.endedAt(nodeId) !== null) {
            return 'ended';
        }
        const chat = sources.chats.get(nodeId);
        const session = chat === undefined ? sources.sessions.get(nodeId) : undefined;
        if (session) {
            // A CLI whose hooks have not spoken yet is one that just started.
            return session.exited ? 'exited' : (session.agent?.status ?? 'running');
        }
        // A chat nobody has loaded is idle: its thread is on disk and a turn opens on it.
        const status = chat?.info.status ?? ((await sources.chats.hasStored(nodeId)) ? 'idle' : 'none');
        // A stopped turn leaves a chat as idle as a finished one; only the turn itself tells them apart.
        if (status === 'idle' && (await sources.chats.lastTurn(nodeId))?.state === 'aborted') {
            return 'stopped';
        }
        return status;
    },
    cancelTurn: (nodeId) => {
        const status = sources.chats.get(nodeId)?.info.status;
        if (status !== 'running' && status !== 'needs-you') {
            return false;
        }
        sources.chats.cancel(nodeId);
        return true;
    }
});
