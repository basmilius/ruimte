import { chatRequests, type ChatRequests } from '@adecore/agents/coordination';
import { agentActions } from '../actions/agent-actions.ts';
import { forkActions } from '../actions/fork-actions.ts';
import { startActions, startPreviews } from '../actions/start-actions.ts';
import { chatForkDeps, forkForAgent, type AgentForkHost } from '../chat/fork.ts';
import { agentStartHost } from '../outbox/start-agent.ts';
import { agentToolkit } from '../tools/agent-tools.ts';
import { openedAgentCount } from '../wiring/agent-state.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* What the chats of agent nodes ask and wait on, which `answer` reaches. */
        requests?: ChatRequests;
        /* Forks a chat an agent opened into a child of that agent; absent on a host that forks none. */
        forks?: AgentForkHost;
    }
}

export const agentFeature = defineAgentFeature({
    name: 'agent',
    toolkit: agentToolkit,
    actions: { ...agentActions, ...startActions, ...forkActions },
    previews: startPreviews,
    host: ({ stores, providers, agents, store, remote, git, enqueue }, whole) => {
        const { lineage, outbox, tasks } = stores;
        const { sessions, chats, chatManager } = agents;
        const forkDeps = chatForkDeps({
            chats: chatManager,
            host: whole,
            titleFor: (id) => store.index.titleFor(id),
            lineage,
            hiddenAgents: store.hiddenAgents,
            worktrees: git.worktrees,
            checkpoints: agents.checkpoints
        });

        return {
            starts: agentStartHost({
                installed: async () => (await providers.providers.list()).filter((provider) => provider.installed).map((provider) => provider.kind),
                providers: providers.providers,
                prompts: stores.prompts,
                enqueue,
                chats,
                sessions,
                lineage,
                openedCount: (callerId) => openedAgentCount({ lineage, hiddenAgents: store.hiddenAgents, tasks, outbox, chats, sessions }, callerId),
                accountsOff: (projectId, kind) => store.index.accountsOf(projectId)?.[kind]?.off ?? []
            }),
            requests: chatRequests(chats),
            forks: { fork: (input, opener) => forkForAgent(forkDeps, input, opener) },
            remote: {
                machines: (projectId) =>
                    store.remote.linksOf(projectId).map((link) => ({
                        machineId: link.machineId,
                        label: link.label,
                        remoteProjectId: link.remoteProjectId,
                        ready: remote.machines.get(link.machineId) !== null
                    })),
                give: (projectId, nodeId, payload) => enqueue(projectId, nodeId, { kind: 'start-remote-agent', payload })
            }
        };
    }
});
