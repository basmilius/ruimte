import { agentMessages } from '../wiring/agent-messages.ts';
import { defineAgentFeature } from './feature.ts';

/* What every tool stands on: the projects, who made which node, the machine's switches and the messages between nodes. */
export const canvasFeature = defineAgentFeature({
    name: 'canvas',
    host: ({ identity, stores, agents, projects, git, work, store, enqueue, later }) => ({
        projects: store,
        hiddenAgents: store.hiddenAgents,
        startClaims: projects.startClaims,
        lineage: stores.lineage,
        checkouts: git.checkouts,
        untrusted: agents.untrusted,
        machine: identity,
        endSession: projects.endSession,
        messages: agentMessages({
            notices: stores.notices,
            sessions: agents.sessions,
            chats: agents.chats,
            projects: store,
            enqueue,
            push: later.push,
            steerMessages: () => identity.steerMessages
        }),
        snoozes: work.snoozes
    })
});
