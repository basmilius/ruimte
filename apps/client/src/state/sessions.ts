import { create } from 'zustand';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { CanvasNode } from '@/state/canvas';
import type { ChatStatuses } from '@/state/chats';
import { dropEndpoint, endpointKey, useEndpointId } from '@/state/keys';

export interface SessionState {
    /* True while this client holds a live attachment on the daemon. */
    attached: boolean;
    /* Exit code of the shell, once it has ended. Absent while it runs. */
    exited?: number;
    /* The agent CLI the daemon last saw in this shell, reported through its hooks. */
    agent?: AgentInfo | null;
    /* A command from the project file the shell started without, until a person on this machine says yes to it. */
    heldCommand?: string;
    /* The account the daemon started this shell's CLI under, also when the node names none; absent is the CLI's default account. */
    account?: string;
}

/* Rows keyed with `endpointKey`, so a session says which daemon it runs on. */
export type SessionsByKey = Record<string, SessionState>;

/* What a session client writes. It owns one machine's socket, so it speaks in node ids alone. */
export interface SessionSink {
    setAttached(nodeId: string, attached: boolean): void;
    setExited(nodeId: string, exitCode: number | undefined): void;
    setAgent(nodeId: string, agent: AgentInfo | null): void;
    setHeldCommand(nodeId: string, command: string | undefined): void;
    setAccount(nodeId: string, account: string | undefined): void;
    forget(nodeId: string): void;
}

interface SessionsStore {
    byKey: SessionsByKey;
    /* How often each terminal was started over; its body rebuilds around the fresh session on every step, so a count never goes back. */
    restarts: Record<string, number>;
    setAttached(key: string, attached: boolean): void;
    setExited(key: string, exitCode: number | undefined): void;
    setAgent(key: string, agent: AgentInfo | null): void;
    setHeldCommand(key: string, command: string | undefined): void;
    setAccount(key: string, account: string | undefined): void;
    forget(key: string): void;
    restart(key: string): void;
    /* Drops one machine's rows. Its sessions keep running; this client is done looking at them. */
    clear(endpointId: string): void;
}

export const useSessions = create<SessionsStore>((set) => ({
    byKey: {},
    restarts: {},
    setAttached(key, attached) {
        set((s) => {
            const current = s.byKey[key];
            // A detach of a node nobody tracks (killed, never attached) must not resurrect an entry.
            if (!current && !attached) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: { ...current, attached } } };
        });
    },
    setExited(key, exitCode) {
        set((s) => ({ byKey: { ...s.byKey, [key]: { ...s.byKey[key], attached: s.byKey[key]?.attached ?? false, exited: exitCode } } }));
    },
    setAgent(key, agent) {
        set((s) => ({ byKey: { ...s.byKey, [key]: { ...s.byKey[key], attached: s.byKey[key]?.attached ?? false, agent } } }));
    },
    setHeldCommand(key, heldCommand) {
        set((s) => {
            const current = s.byKey[key];
            if (current?.heldCommand === heldCommand || (!current && heldCommand === undefined)) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: { ...current, attached: current?.attached ?? false, heldCommand } } };
        });
    },
    setAccount(key, account) {
        set((s) => {
            const current = s.byKey[key];
            if (current?.account === account || (!current && account === undefined)) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: { ...current, attached: current?.attached ?? false, account } } };
        });
    },
    forget(key) {
        set((s) => {
            const next = { ...s.byKey };
            delete next[key];
            return { byKey: next };
        });
    },
    restart(key) {
        set((s) => ({ restarts: { ...s.restarts, [key]: (s.restarts[key] ?? 0) + 1 } }));
    },
    clear(endpointId) {
        set((s) => ({ byKey: dropEndpoint(s.byKey, endpointId) }));
    }
}));

/* The sink of one daemon's session client: it hands over node ids, this puts them under its machine. */
export const sessionSinkFor = (endpointId: string): SessionSink => ({
    setAttached: (nodeId, attached) => useSessions.getState().setAttached(endpointKey(endpointId, nodeId), attached),
    setExited: (nodeId, exitCode) => useSessions.getState().setExited(endpointKey(endpointId, nodeId), exitCode),
    setAgent: (nodeId, agent) => useSessions.getState().setAgent(endpointKey(endpointId, nodeId), agent),
    setHeldCommand: (nodeId, command) => useSessions.getState().setHeldCommand(endpointKey(endpointId, nodeId), command),
    setAccount: (nodeId, account) => useSessions.getState().setAccount(endpointKey(endpointId, nodeId), account),
    forget: (nodeId) => useSessions.getState().forget(endpointKey(endpointId, nodeId))
});

/* How often a terminal on the machine in scope was started over. */
export const useSessionRestarts = (nodeId: string): number => {
    const endpointId = useEndpointId();
    return useSessions((s) => s.restarts[endpointKey(endpointId, nodeId)] ?? 0);
};

/* One node's session on the machine in scope. The selector keeps a render tied to the field it reads. */
export const useSessionRow = <T>(nodeId: string, select: (row: SessionState | undefined) => T): T => {
    const endpointId = useEndpointId();
    return useSessions((s) => select(s.byKey[endpointKey(endpointId, nodeId)]));
};

const sessionStatus = (state: SessionState | undefined): AgentStatus | undefined => {
    if (!state) {
        return undefined;
    }
    // A live agent knows better than the shell what is going on.
    if (state.agent?.live) {
        return state.agent.status;
    }
    // The daemon marks the record when the CLI went down with the shell, and it outlives the shell.
    if (state.agent?.status === 'exited') {
        return 'exited';
    }
    if (state.exited !== undefined) {
        return 'error';
    }
    return state.attached ? 'running' : undefined;
};

/* What a node needs to have a status. Geometry says nothing about whether something is running. */
export type StatusOf = Pick<CanvasNode, 'id' | 'kind' | 'status'>;

/* A terminal's status comes from its session, a chat's from its thread; anything else still carries it on the node. */
export const nodeStatus = (node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): AgentStatus | undefined => {
    if (node.kind === 'terminal') {
        return sessionStatus(sessions[endpointKey(endpointId, node.id)]);
    }
    if (node.kind === 'chat') {
        return chats[endpointKey(endpointId, node.id)]?.info.status;
    }
    return node.status;
};
