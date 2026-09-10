import { create } from 'zustand';
import type { ProviderInfo } from '@ruimte/contracts';

interface ProvidersStore {
    providers: ProviderInfo[];
    loaded: boolean;
    setProviders(providers: ProviderInfo[]): void;
}

/* What the daemon reports about the agent CLIs and their models; filled once per connection. */
export const useProviders = create<ProvidersStore>((set) => ({
    providers: [],
    loaded: false,
    setProviders(providers) {
        set({ providers, loaded: true });
    }
}));
