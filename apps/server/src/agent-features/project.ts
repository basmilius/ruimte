import { projectIgnoredActions } from '../actions/project-ignored-actions.ts';
import { projectProposalActions } from '../actions/project-proposal-actions.ts';
import { projectReach } from '../canvas/reach.ts';
import type { ProposalAnswer, ProposalAsk } from '../projects/project-proposals.ts';
import { projectToolkit } from '../tools/project-tools.ts';
import { chatIsInChats } from '../wiring/chat-move.ts';
import { defineAgentFeature } from './feature.ts';

/* A suggestion makes nothing: it only raises the card, and what became of it comes back. */
interface ProposalHost {
    /* Whether the chat is a chat view of the Chats project, the only place a project is suggested from. */
    inChats(chatId: string): boolean;
    propose(ask: ProposalAsk): Promise<ProposalAnswer>;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The cards in which an agent in Chats suggests a project; absent on a host that keeps none. */
        proposals?: ProposalHost;
    }
}

export const projectFeature = defineAgentFeature({
    name: 'project',
    toolkit: projectToolkit,
    actions: { ...projectProposalActions, ...projectIgnoredActions },
    host: ({ identity, agents, store }) => ({
        proposals: { inChats: (chatId) => chatIsInChats(store, chatId), propose: (ask) => Promise.resolve(agents.proposals.ask(ask)) },
        reach: projectReach(
            store,
            () => identity.reachOpenProjects,
            () => identity.worktreeRoot
        )
    })
});
