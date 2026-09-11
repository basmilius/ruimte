import { create } from 'zustand';
import type { ProviderInfo } from '@ruimte/contracts';

interface ProvidersStore {
    providers: ProviderInfo[];
    loaded: boolean;
    setProviders(providers: ProviderInfo[]): void;
    /* Which CLIs are installed is the machine's answer, not this client's. */
    clear(): void;
}

/* What the daemon reports about the agent CLIs and their models; filled once per connection. */
export const useProviders = create<ProvidersStore>((set) => ({
    providers: [],
    loaded: false,
    setProviders(providers) {
        set({ providers, loaded: true });
    },
    clear() {
        set({ providers: [], loaded: false });
    }
}));
