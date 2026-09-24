import { useMemo } from 'react';
import { create } from 'zustand';
import type { ComputerApproval, ComputerUseStatus } from '@ruimte/contracts';

const NONE: readonly ComputerApproval[] = [];

interface ComputerStore {
    /* Per machine, every card it has up: an agent there waits for a person to let it into an app. */
    approvals: Readonly<Record<string, readonly ComputerApproval[]>>;
    /* Per machine, whether computer use is on there, its grants and the session the machine last heard of. */
    statuses: Readonly<Record<string, ComputerUseStatus>>;
    setApprovals(endpointId: string, approvals: readonly ComputerApproval[]): void;
    setStatus(endpointId: string, status: ComputerUseStatus): void;
    forget(endpointId: string): void;
}

export const useComputer = create<ComputerStore>((set, get) => ({
    approvals: {},
    statuses: {},
    setApprovals(endpointId, approvals) {
        set({ approvals: { ...get().approvals, [endpointId]: approvals } });
    },
    setStatus(endpointId, status) {
        set({ statuses: { ...get().statuses, [endpointId]: status } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...approvals } = get().approvals;
        const { [endpointId]: _status, ...statuses } = get().statuses;
        set({ approvals, statuses });
    }
}));

export const computerApprovalsOf = (endpointId: string): readonly ComputerApproval[] => useComputer.getState().approvals[endpointId] ?? NONE;

/* The cards of one chat or terminal, oldest first, which is the order the machine sends them in. */
export const useNodeComputerApprovals = (endpointId: string, nodeId: string): readonly ComputerApproval[] => {
    const all = useComputer((s) => s.approvals[endpointId] ?? NONE);
    return useMemo(() => (all.some((approval) => approval.nodeId === nodeId) ? all.filter((approval) => approval.nodeId === nodeId) : NONE), [all, nodeId]);
};
