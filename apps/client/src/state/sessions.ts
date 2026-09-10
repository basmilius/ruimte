import { create } from 'zustand';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { CanvasNode } from '@/state/canvas';
import type { ChatsById } from '@/state/chats';

interface SessionState {
    /* True while this client holds a live attachment on the daemon. */
    attached: boolean;
    /* Exit code of the shell, once it has ended. Absent while it runs. */
    exited?: number;
    /* The agent CLI the daemon last saw in this shell, reported through its hooks. */
    agent?: AgentInfo | null;
}

export interface SessionSink {
    setAttached(nodeId: string, attached: boolean): void;
    setExited(nodeId: string, exitCode: number | undefined): void;
    setAgent(nodeId: string, agent: AgentInfo | null): void;
    forget(nodeId: string): void;
}

interface SessionsStore extends SessionSink {
    byNodeId: Record<string, SessionState>;
}

export const useSessions = create<SessionsStore>((set) => ({
    byNodeId: {},
    setAttached(nodeId, attached) {
        set((s) => {
            const current = s.byNodeId[nodeId];
            // A detach of a node nobody tracks (killed, never attached) must not resurrect an entry.
            if (!current && !attached) {
                return {};
            }
            return { byNodeId: { ...s.byNodeId, [nodeId]: { ...current, attached } } };
        });
    },
    setExited(nodeId, exitCode) {
        set((s) => ({ byNodeId: { ...s.byNodeId, [nodeId]: { ...s.byNodeId[nodeId], attached: s.byNodeId[nodeId]?.attached ?? false, exited: exitCode } } }));
    },
    setAgent(nodeId, agent) {
        set((s) => ({ byNodeId: { ...s.byNodeId, [nodeId]: { ...s.byNodeId[nodeId], attached: s.byNodeId[nodeId]?.attached ?? false, agent } } }));
    },
    forget(nodeId) {
        set((s) => {
            const next = { ...s.byNodeId };
            delete next[nodeId];
            return { byNodeId: next };
        });
    }
}));

const sessionStatus = (state: SessionState | undefined): AgentStatus | undefined => {
    if (!state) {
        return undefined;
    }
    // A live agent knows better than the shell what is going on.
    if (state.agent?.live) {
        return state.agent.status;
    }
    if (state.exited !== undefined) {
        return 'error';
    }
    return state.attached ? 'running' : undefined;
};

/* A terminal's status comes from its session, a chat's from its thread; anything else still carries it on the node. */
export const nodeStatus = (node: CanvasNode, sessions: Record<string, SessionState>, chats: ChatsById): AgentStatus | undefined => {
    if (node.kind === 'terminal') {
        return sessionStatus(sessions[node.id]);
    }
    if (node.kind === 'chat') {
        return chats[node.id]?.info.status;
    }
    return node.status;
};
