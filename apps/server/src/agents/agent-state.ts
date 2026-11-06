import type { AgentStatus } from '@ruimte/contracts';

/*
 * What runs in an agent node as far as the daemon knows it: a start still owed in the outbox, the
 * status its hooks or its chat report, ended along with the node that opened it, a chat at rest
 * whose last turn was stopped before it finished, or nothing at all.
 */
export type AgentState = 'owed' | 'ended' | 'stopped' | 'none' | AgentStatus;

export interface AgentStateHost {
    stateOf(nodeId: string): Promise<AgentState>;
    /* The node that started this one as an agent through agent or team; null for any other node. */
    startedBy(nodeId: string): string | null;
    /* Stops the turn a chat node is working on; false when it is no chat or has no turn going. */
    cancelTurn(nodeId: string): boolean;
}
