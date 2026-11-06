import { operationActions } from '../actions/operation-actions.ts';
import type { AgentStateHost } from '../agents/agent-state.ts';
import { operationToolkit } from '../tools/operation-tools.ts';
import { agentStates } from '../wiring/agent-state.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* What runs in an agent node now, which is what an operation of `agent` or `team` is read from. */
        agents?: AgentStateHost;
    }
}

export const operationFeature = defineAgentFeature({
    name: 'operation',
    toolkit: operationToolkit,
    actions: operationActions,
    host: ({ stores, agents }) => ({
        agents: agentStates({ outbox: stores.outbox, lineage: stores.lineage, chats: agents.chats, sessions: agents.sessions })
    })
});
