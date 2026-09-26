import { create } from 'zustand';
import type { ProviderAccounts } from '@ruimte/agent-contracts';
import { useChatScope } from '../scope';
import type { ChatTransport } from '../transport';

export interface ProviderAccountsRow {
    /* Null until the host answered, and for a host too old to keep accounts. */
    accounts: ProviderAccounts | null;
    loaded: boolean;
}

/* One object for a host that has not answered yet, so a selector gets a stable snapshot. */
const NONE: ProviderAccountsRow = { accounts: null, loaded: false };

interface ProviderAccountsStore {
    byScope: Record<string, ProviderAccountsRow>;
    set(scopeId: string, accounts: ProviderAccounts | null): void;
    forget(scopeId: string): void;
}

/* The accounts of every agent CLI on each host, and what each CLI last said about who is signed in there. */
export const useProviderAccountsStore = create<ProviderAccountsStore>((set, get) => ({
    byScope: {},
    set(scopeId, accounts) {
        set({ byScope: { ...get().byScope, [scopeId]: { accounts, loaded: true } } });
    },
    forget(scopeId) {
        const { [scopeId]: _gone, ...rest } = get().byScope;
        set({ byScope: rest });
    }
}));

/* The accounts of the host in scope, like `useProviders`. */
export const useProviderAccounts = <T>(select: (row: ProviderAccountsRow) => T): T => {
    const { id } = useChatScope();
    return useProviderAccountsStore((s) => select(s.byScope[id] ?? NONE));
};

export const providerAccountsOf = (scopeId: string): ProviderAccountsRow => useProviderAccountsStore.getState().byScope[scopeId] ?? NONE;

/* The accounts as `accountFor` takes them: undefined until the host answered, null for one that keeps none. */
export const knownAccounts = (row: ProviderAccountsRow): ProviderAccounts | null | undefined => (row.loaded ? row.accounts : undefined);

/*
 * Keeps one host's accounts in the store: the whole list on every fresh link, then every change the
 * host announces. Answers the function that stops it.
 */
export const watchProviderAccounts = (scopeId: string, transport: ChatTransport): (() => void) => {
    const store = useProviderAccountsStore.getState();
    // A list asked for before a change arrived is older than that change, so it is dropped.
    let changes = 0;
    const load = (): void => {
        const asked = changes;
        transport
            .request('accounts.list', {})
            .then((accounts) => {
                if (changes === asked) {
                    store.set(scopeId, accounts);
                }
            })
            .catch(() => {
                // A host from before accounts never answers; it has only each CLI's own login.
                if (changes === asked && !providerAccountsOf(scopeId).loaded) {
                    store.set(scopeId, null);
                }
            });
    };
    const off = [
        transport.on('accounts.changed', (accounts) => {
            changes += 1;
            store.set(scopeId, accounts);
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
