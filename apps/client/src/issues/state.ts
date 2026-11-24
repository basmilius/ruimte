import type { HostChange, HostLink, HostProviderStatus, HostRef } from '@ruimte/contracts';
import { create } from 'zustand';
import { useEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';

interface HostsState {
    /* By `endpointKey(endpointId, projectId)`: where the project's issues and changes come from, as the machine found it last. */
    providers: Record<string, readonly HostProviderStatus[]>;
    /* By the same key: every link between a chat of the project and an issue. */
    links: Record<string, readonly HostLink[]>;
    /* By `endpointKey(endpointId, chatId)`: the change of the branch the chat works on, null for a branch without one. */
    changes: Record<string, HostChange | null>;
    setProviders(endpointId: string, projectId: string, providers: readonly HostProviderStatus[]): void;
    setLinks(endpointId: string, projectId: string, links: readonly HostLink[]): void;
    setChange(endpointId: string, chatId: string, change: HostChange | null): void;
    clear(): void;
}

export const useHosts = create<HostsState>((set, get) => ({
    providers: {},
    links: {},
    changes: {},
    setProviders(endpointId, projectId, providers) {
        set({ providers: { ...get().providers, [endpointKey(endpointId, projectId)]: providers } });
    },
    setLinks(endpointId, projectId, links) {
        set({ links: { ...get().links, [endpointKey(endpointId, projectId)]: links } });
    },
    setChange(endpointId, chatId, change) {
        set({ changes: { ...get().changes, [endpointKey(endpointId, chatId)]: change } });
    },
    clear() {
        set({ providers: {}, links: {}, changes: {} });
    }
}));

const NO_PROVIDERS: readonly HostProviderStatus[] = [];
const NO_LINKS: readonly HostLink[] = [];

function useProjectKey(): string | null {
    const endpointId = useEndpointId();
    const projectId = useProject((state) => state.current?.projectId ?? null);

    return projectId === null ? null : endpointKey(endpointId, projectId);
}

/* Empty for a machine that knows no hosts and for a project none of them answers for, which both show nothing. */
export function useHostProviders(): readonly HostProviderStatus[] {
    const key = useProjectKey();

    return useHosts((state) => (key === null ? NO_PROVIDERS : (state.providers[key] ?? NO_PROVIDERS)));
}

export function useProjectLinks(): readonly HostLink[] {
    const key = useProjectKey();

    return useHosts((state) => (key === null ? NO_LINKS : (state.links[key] ?? NO_LINKS)));
}

export function useChatLinks(chatId: string): readonly HostLink[] {
    return useProjectLinks().filter((link) => link.chatId === chatId);
}

export function useIssueLinks(ref: HostRef | null): readonly HostLink[] {
    return useProjectLinks().filter((link) => link.ref === ref);
}

/* Undefined until the machine was asked. */
export function useChatChange(chatId: string): HostChange | null | undefined {
    const endpointId = useEndpointId();

    return useHosts((state) => state.changes[endpointKey(endpointId, chatId)]);
}
