import { useMemo } from 'react';
import { create } from 'zustand';
import type { ComputerAppGrants, ComputerApproval, ComputerUseStatus } from '@ruimte/contracts';

const NONE: readonly ComputerApproval[] = [];

interface ComputerStore {
    /* Per machine, every card it has up: an agent there waits for a person to let it into an app. */
    approvals: Readonly<Record<string, readonly ComputerApproval[]>>;
    /* Per machine, whether computer use is on there, its grants and the session the machine last heard of. */
    statuses: Readonly<Record<string, ComputerUseStatus>>;
    /* Per machine, what a person allowed there and can take back; absent until the machine answered. */
    grants: Readonly<Record<string, ComputerAppGrants>>;
    setApprovals(endpointId: string, approvals: readonly ComputerApproval[]): void;
    setStatus(endpointId: string, status: ComputerUseStatus): void;
    setGrants(endpointId: string, grants: ComputerAppGrants): void;
    forget(endpointId: string): void;
}

export const useComputer = create<ComputerStore>((set, get) => ({
    approvals: {},
    statuses: {},
    grants: {},
    setApprovals(endpointId, approvals) {
        set({ approvals: { ...get().approvals, [endpointId]: approvals } });
    },
    setStatus(endpointId, status) {
        set({ statuses: { ...get().statuses, [endpointId]: status } });
    },
    setGrants(endpointId, grants) {
        set({ grants: { ...get().grants, [endpointId]: grants } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...approvals } = get().approvals;
        const { [endpointId]: _status, ...statuses } = get().statuses;
        const { [endpointId]: _grants, ...grants } = get().grants;
        set({ approvals, statuses, grants });
    }
}));

export const computerApprovalsOf = (endpointId: string): readonly ComputerApproval[] => useComputer.getState().approvals[endpointId] ?? NONE;

/* The cards of one chat or terminal, oldest first, which is the order the machine sends them in. */
export const useNodeComputerApprovals = (endpointId: string, nodeId: string): readonly ComputerApproval[] => {
    const all = useComputer((s) => s.approvals[endpointId] ?? NONE);
    return useMemo(() => (all.some((approval) => approval.nodeId === nodeId) ? all.filter((approval) => approval.nodeId === nodeId) : NONE), [all, nodeId]);
};
