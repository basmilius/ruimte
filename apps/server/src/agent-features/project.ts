import { projectIgnoredActions } from '../actions/project-ignored-actions.ts';
import { projectProposalActions } from '../actions/project-proposal-actions.ts';
import { projectReach } from '../canvas/reach.ts';
import { projectToolkit } from '../tools/project-tools.ts';
import { chatIsInChats } from '../wiring/chat-move.ts';
import { defineAgentFeature } from './feature.ts';

export const projectFeature = defineAgentFeature({
    name: 'project',
    toolkit: projectToolkit,
    actions: { ...projectProposalActions, ...projectIgnoredActions },
    host: ({ identity, agents, store }) => ({
        proposals: { inChats: (chatId) => chatIsInChats(store, chatId), propose: (ask) => Promise.resolve(agents.proposals.ask(ask)) },
        reach: projectReach(store, () => identity.reachOpenProjects)
    })
});
