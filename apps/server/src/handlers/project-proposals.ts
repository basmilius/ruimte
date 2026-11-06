import type { Area } from '../area.ts';
import type { ProjectProposals } from '../projects/project-proposals.ts';

export interface ProposalsDeps {
    proposals: Pick<ProjectProposals, 'list' | 'decline' | 'subscribe'>;
}

/* Every client of the machine is its owner or one the owner let in, so any of them answers a card, as a question of a chat is answered. */
export function proposalsArea({ proposals }: ProposalsDeps): Area {
    return {
        name: 'proposals',
        sources: [proposals],
        handlers: (dispatcher) => {
            dispatcher.register('chat.proposals', () => ({ proposals: proposals.list() }));

            dispatcher.register('chat.proposalDecline', (payload) => ({ accepted: proposals.decline(payload.proposalId) }));
        }
    };
}
