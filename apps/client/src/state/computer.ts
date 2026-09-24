import { useMemo } from 'react';
import { create } from 'zustand';
import type { ComputerApproval } from '@ruimte/contracts';

const NONE: readonly ComputerApproval[] = [];

interface ComputerStore {
    /* Per machine, every card it has up: an agent there waits for a person to let it into an app. */
    approvals: Readonly<Record<string, readonly ComputerApproval[]>>;
    setApprovals(endpointId: string, approvals: readonly ComputerApproval[]): void;
    forget(endpointId: string): void;
}

export const useComputer = create<ComputerStore>((set, get) => ({
    approvals: {},
    setApprovals(endpointId, approvals) {
        set({ approvals: { ...get().approvals, [endpointId]: approvals } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().approvals;
        set({ approvals: rest });
    }
}));

export const computerApprovalsOf = (endpointId: string): readonly ComputerApproval[] => useComputer.getState().approvals[endpointId] ?? NONE;

/* The cards of one chat or terminal, oldest first, which is the order the machine sends them in. */
export const useNodeComputerApprovals = (endpointId: string, nodeId: string): readonly ComputerApproval[] => {
    const all = useComputer((s) => s.approvals[endpointId] ?? NONE);
    return useMemo(() => (all.some((approval) => approval.nodeId === nodeId) ? all.filter((approval) => approval.nodeId === nodeId) : NONE), [all, nodeId]);
};
