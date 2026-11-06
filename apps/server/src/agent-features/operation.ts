import { operationActions } from '../actions/operation-actions.ts';
import { operationToolkit } from '../tools/operation-tools.ts';
import { agentStates } from '../wiring/agent-state.ts';
import { defineAgentFeature } from './feature.ts';

export const operationFeature = defineAgentFeature({
    name: 'operation',
    toolkit: operationToolkit,
    actions: operationActions,
    host: ({ stores, agents }) => ({
        agents: agentStates({ outbox: stores.outbox, lineage: stores.lineage, chats: agents.chats, sessions: agents.sessions })
    })
});
