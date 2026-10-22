import { create } from 'zustand';
import type { SecretRequest } from '@ruimte/contracts';

const NONE: readonly SecretRequest[] = [];

interface SecretStore {
    /* Per machine, every card it has up: an agent there waits for a person to give a launch a secret. Never a value. */
    requests: Readonly<Record<string, readonly SecretRequest[]>>;
    setRequests(endpointId: string, requests: readonly SecretRequest[]): void;
    forget(endpointId: string): void;
}

export const useSecrets = create<SecretStore>((set, get) => ({
    requests: {},
    setRequests(endpointId, requests) {
        set({ requests: { ...get().requests, [endpointId]: requests } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...requests } = get().requests;
        set({ requests });
    }
}));

export function secretRequestsOf(endpointId: string): readonly SecretRequest[] {
    return useSecrets.getState().requests[endpointId] ?? NONE;
}

/* The cards of one chat, oldest first, which is the order the machine sends them in. */
export function useNodeSecretRequests(endpointId: string, nodeId: string): readonly SecretRequest[] {
    const all = useSecrets((s) => s.requests[endpointId] ?? NONE);
    return all.some((request) => request.nodeId === nodeId) ? all.filter((request) => request.nodeId === nodeId) : NONE;
}
