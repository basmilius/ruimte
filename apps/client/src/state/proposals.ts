import { create } from 'zustand';
import type { ProjectProposal } from '@ruimte/contracts';

const NONE: readonly ProjectProposal[] = [];

interface ProposalStore {
    /* Per machine, every suggestion it holds: an agent in Chats thinks its chat has become a project and waits for a person. */
    proposals: Readonly<Record<string, readonly ProjectProposal[]>>;
    setProposals(endpointId: string, proposals: readonly ProjectProposal[]): void;
    forget(endpointId: string): void;
}

export const useProposals = create<ProposalStore>((set, get) => ({
    proposals: {},
    setProposals(endpointId, proposals) {
        set({ proposals: { ...get().proposals, [endpointId]: proposals } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...proposals } = get().proposals;
        set({ proposals });
    }
}));

export function proposalsOf(endpointId: string): readonly ProjectProposal[] {
    return useProposals.getState().proposals[endpointId] ?? NONE;
}

/* The suggestion of one chat, which is at most one. */
export function useNodeProposals(endpointId: string, chatId: string): readonly ProjectProposal[] {
    const all = useProposals((s) => s.proposals[endpointId] ?? NONE);
    return all.some((proposal) => proposal.chatId === chatId) ? all.filter((proposal) => proposal.chatId === chatId) : NONE;
}
