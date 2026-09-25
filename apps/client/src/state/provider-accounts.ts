import { create } from 'zustand';
import type { ProviderAccounts } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import type { Transport } from '@/transport/transport';

export interface ProviderAccountsRow {
    /* Null until the machine answered, and for a machine too old to keep accounts. */
    accounts: ProviderAccounts | null;
    loaded: boolean;
}

/* One object for a machine that has not answered yet, so a selector gets a stable snapshot. */
const NONE: ProviderAccountsRow = { accounts: null, loaded: false };

interface ProviderAccountsStore {
    byEndpoint: Record<string, ProviderAccountsRow>;
    set(endpointId: string, accounts: ProviderAccounts | null): void;
    forget(endpointId: string): void;
}

/* The accounts of every agent CLI on each machine, and what each CLI last said about who is signed in there. */
export const useProviderAccountsStore = create<ProviderAccountsStore>((set, get) => ({
    byEndpoint: {},
    set(endpointId, accounts) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { accounts, loaded: true } } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

/* The accounts of the machine in scope, like `useProviders`. */
export const useProviderAccounts = <T>(select: (row: ProviderAccountsRow) => T): T => {
    const endpointId = useEndpointId();
    return useProviderAccountsStore((s) => select(s.byEndpoint[endpointId] ?? NONE));
};

export const providerAccountsOf = (endpointId: string): ProviderAccountsRow => useProviderAccountsStore.getState().byEndpoint[endpointId] ?? NONE;

/* The accounts as `accountFor` takes them: undefined until the machine answered, null for one that keeps none. */
export const knownAccounts = (row: ProviderAccountsRow): ProviderAccounts | null | undefined => (row.loaded ? row.accounts : undefined);

/*
 * Keeps one machine's accounts in the store: the whole list on every fresh socket, then every change
 * the machine announces. Answers the function that stops it.
 */
export const watchProviderAccounts = (endpointId: string, transport: Transport): (() => void) => {
    const store = useProviderAccountsStore.getState();
    // A list asked for before a change arrived is older than that change, so it is dropped.
    let changes = 0;
    const load = (): void => {
        const asked = changes;
        transport
            .request('accounts.list', {})
            .then((accounts) => {
                if (changes === asked) {
                    store.set(endpointId, accounts);
                }
            })
            .catch(() => {
                // A machine from before accounts never answers; it has only each CLI's own login.
                if (changes === asked && !providerAccountsOf(endpointId).loaded) {
                    store.set(endpointId, null);
                }
            });
    };
    const off = [
        transport.on('accounts.changed', (accounts) => {
            changes += 1;
            store.set(endpointId, accounts);
        }),
        transport.subscribeStatus((status) => {
            if (status === 'open') {
                load();
            }
        })
    ];
    if (transport.status === 'open') {
        load();
    }
    return () => off.forEach((stop) => stop());
};
