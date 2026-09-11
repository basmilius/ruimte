import { create } from 'zustand';
import type { ProviderInfo } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';

export interface ProvidersRow {
    providers: ProviderInfo[];
    loaded: boolean;
}

/* One object for a machine that has not answered yet, so a selector gets a stable snapshot. */
const NONE: ProvidersRow = { providers: [], loaded: false };

interface ProvidersStore {
    byEndpoint: Record<string, ProvidersRow>;
    setProviders(endpointId: string, providers: ProviderInfo[]): void;
    /* A machine that is forgotten takes its list of CLIs with it. */
    forget(endpointId: string): void;
}

/* Which agent CLIs each daemon reports, and their models; filled once per connection. */
export const useProvidersStore = create<ProvidersStore>((set, get) => ({
    byEndpoint: {},
    setProviders(endpointId, providers) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { providers, loaded: true } } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

/*
 * The CLIs of the machine in scope. An agent menu has to offer what the machine the node will run
 * on has installed, never what another machine answered.
 */
export const useProviders = <T>(select: (row: ProvidersRow) => T): T => {
    const endpointId = useEndpointId();
    return useProvidersStore((s) => select(s.byEndpoint[endpointId] ?? NONE));
};

/* The same answer outside a render. */
export const providersOf = (endpointId: string): ProvidersRow => useProvidersStore.getState().byEndpoint[endpointId] ?? NONE;

/* What one daemon's chat client fills in; it knows its own machine and nothing of the others. */
export const providerSinkFor = (endpointId: string): { setProviders(providers: ProviderInfo[]): void } => ({
    setProviders: (providers) => useProvidersStore.getState().setProviders(endpointId, providers)
});
