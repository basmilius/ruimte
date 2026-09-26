import { create } from 'zustand';
import type { ProviderInfo } from '@ruimte/agent-contracts';
import { useChatScope } from '../scope';

export interface ProvidersRow {
    providers: ProviderInfo[];
    loaded: boolean;
}

/* One object for a host that has not answered yet, so a selector gets a stable snapshot. */
const NONE: ProvidersRow = { providers: [], loaded: false };

interface ProvidersStore {
    byScope: Record<string, ProvidersRow>;
    setProviders(scopeId: string, providers: ProviderInfo[]): void;
    forget(scopeId: string): void;
}

/* Which agent CLIs each host reports, and their models; filled once per connection. */
export const useProvidersStore = create<ProvidersStore>((set, get) => ({
    byScope: {},
    setProviders(scopeId, providers) {
        set({ byScope: { ...get().byScope, [scopeId]: { providers, loaded: true } } });
    },
    forget(scopeId) {
        const { [scopeId]: _gone, ...rest } = get().byScope;
        set({ byScope: rest });
    }
}));

/*
 * The CLIs of the host in scope. An agent menu has to offer what the host the chat will run on has
 * installed, never what another host answered.
 */
export const useProviders = <T>(select: (row: ProvidersRow) => T): T => {
    const { id } = useChatScope();
    return useProvidersStore((s) => select(s.byScope[id] ?? NONE));
};

/* The same answer outside a render. */
export const providersOf = (scopeId: string): ProvidersRow => useProvidersStore.getState().byScope[scopeId] ?? NONE;

/* What one host's chat client fills in; it knows its own host and nothing of the others. */
export const providerSinkFor = (scopeId: string): { setProviders(providers: ProviderInfo[]): void } => ({
    setProviders: (providers) => useProvidersStore.getState().setProviders(scopeId, providers)
});
