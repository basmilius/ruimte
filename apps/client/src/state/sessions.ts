import { create } from 'zustand';
import type { AgentStatus, CanvasNode } from '@/state/canvas';

export interface SessionState {
    /* True while this client holds a live attachment on the daemon. */
    attached: boolean;
    /* Exit code of the shell, once it has ended. Absent while it runs. */
    exited?: number;
}

export interface SessionSink {
    setAttached(nodeId: string, attached: boolean): void;
    setExited(nodeId: string, exitCode: number | undefined): void;
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
        set((s) => ({ byNodeId: { ...s.byNodeId, [nodeId]: { attached: s.byNodeId[nodeId]?.attached ?? false, exited: exitCode } } }));
    },
    forget(nodeId) {
        set((s) => {
            const next = { ...s.byNodeId };
            delete next[nodeId];
            return { byNodeId: next };
        });
    }
}));

export const sessionStatus = (state: SessionState | undefined): AgentStatus | undefined => {
    if (!state) {
        return undefined;
    }
    if (state.exited !== undefined) {
        return 'error';
    }
    return state.attached ? 'running' : undefined;
};

/* A terminal's status comes from its session, every other kind still carries it on the node. */
export const nodeStatus = (node: CanvasNode, sessions: Record<string, SessionState>): AgentStatus | undefined =>
    node.kind === 'terminal' ? sessionStatus(sessions[node.id]) : node.status;

export const useNodeStatus = (node: CanvasNode): AgentStatus | undefined =>
    useSessions((s) => nodeStatus(node, s.byNodeId));
