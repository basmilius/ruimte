import type { TunnelProposal } from '@ruimte/contracts';
import { create } from 'zustand';

const NONE: readonly TunnelProposal[] = [];

interface TunnelProposalStore {
    /* Per machine, every card in which an agent suggests a change to a hostname of its tunnel and waits for a person. */
    proposals: Readonly<Record<string, readonly TunnelProposal[]>>;
    setProposals(endpointId: string, proposals: readonly TunnelProposal[]): void;
    forget(endpointId: string): void;
}

export const useTunnelProposals = create<TunnelProposalStore>((set, get) => ({
    proposals: {},
    setProposals(endpointId, proposals) {
        set({ proposals: { ...get().proposals, [endpointId]: proposals } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...proposals } = get().proposals;

        set({ proposals });
    }
}));

export function tunnelProposalsOf(endpointId: string): readonly TunnelProposal[] {
    return useTunnelProposals.getState().proposals[endpointId] ?? NONE;
}

/* The cards of one chat, oldest first, which is the order the machine sends them in. */
export function useNodeTunnelProposals(endpointId: string, chatId: string): readonly TunnelProposal[] {
    const all = useTunnelProposals((state) => state.proposals[endpointId] ?? NONE);

    return all.some((proposal) => proposal.chatId === chatId) ? all.filter((proposal) => proposal.chatId === chatId) : NONE;
}
