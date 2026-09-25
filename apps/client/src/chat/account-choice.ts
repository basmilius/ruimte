import { useMemo } from 'react';
import type { AgentKind, ProviderAccounts } from '@ruimte/contracts';
import { accountName, accountsOfKind, hasAccountChoice, offeredAccounts, type AccountEntry } from '@/agents/accounts';
import { useProviderAccounts } from '@/state/provider-accounts';
import { useProviders } from '@/state/providers';

export interface AccountChoice {
    accounts: ProviderAccounts;
    /* The accounts a person may pick for this CLI: those that are on, and the one in use. */
    offered: AccountEntry[];
    /* The account the chat runs under, by id; the CLI's kind for its default account. */
    currentId: string;
    /* Null for an account the machine no longer has. */
    current: AccountEntry | null;
    providerName: string;
    nameOf(entry: AccountEntry): string;
}

/*
 * The accounts of a chat's CLI on the machine in scope and the one the chat runs under, or null while
 * the CLI has fewer than two accounts that are on: with one there is nothing to choose or tell apart.
 */
export const useAccountChoice = (kind: AgentKind | null, account: string | undefined): AccountChoice | null => {
    const accounts = useProviderAccounts((row) => row.accounts);
    const providerName = useProviders((row) => row.providers.find((entry) => entry.kind === kind)?.name) ?? kind ?? '';
    return useMemo(() => {
        if (kind === null || accounts === null) {
            return null;
        }
        const entries = accountsOfKind(accounts, kind);
        if (!hasAccountChoice(entries)) {
            return null;
        }
        const currentId = account ?? kind;
        return {
            accounts,
            offered: offeredAccounts(entries, currentId),
            currentId,
            current: entries.find((entry) => entry.id === currentId) ?? null,
            providerName,
            nameOf: (entry: AccountEntry) => accountName(entry, providerName)
        };
    }, [accounts, kind, account, providerName]);
};
