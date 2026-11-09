import { machineTransport } from '@/transport';

/* A person's no to a project suggestion, straight to the machine that holds the card. False when the card was gone already. */
export interface ProposalAnswers {
    decline(endpointId: string, proposalId: string): Promise<boolean>;
}

export const proposalAnswers: ProposalAnswers = {
    decline: async (endpointId, proposalId) => (await machineTransport(endpointId).request('chat.proposalDecline', { proposalId })).accepted
};

/* A person's answer to a tunnel suggestion. A confirm makes the change, so it resolves only once Cloudflare answered. */
export interface TunnelProposalAnswers {
    confirm(endpointId: string, proposalId: string): Promise<boolean>;
    decline(endpointId: string, proposalId: string): Promise<boolean>;
}

export const tunnelProposalAnswers: TunnelProposalAnswers = {
    confirm: async (endpointId, proposalId) => (await machineTransport(endpointId).request('tunnel.proposalConfirm', { proposalId })).accepted,
    decline: async (endpointId, proposalId) => (await machineTransport(endpointId).request('tunnel.proposalDecline', { proposalId })).accepted
};
