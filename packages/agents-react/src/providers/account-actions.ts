import i18next from 'i18next';
import type { AgentKind, ProviderAccount, ProviderAccountMap } from '@ruimte/agent-contracts';
import { accountFor, readChatPreferences, rememberChatAccount } from '../chat/preferences';
import { chatHost } from '../host';
import type { ChatScope } from '../scope';
import { providerAccountsOf, useProviderAccountsStore } from '../state/provider-accounts';
import type { ChatTransport } from '../transport';

const words = (key: string, values?: Record<string, string>): string => i18next.t(`agent-providers:${key}`, values);

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const linkTo = (scope: ChatScope): ChatTransport => {
    if (scope.transport.status !== 'open') {
        throw new Error(words('notAnswering'));
    }
    return scope.transport;
};

/* The whole map, as `accounts.save` takes it. Answers false when the host refused, which a toast then says. */
export const saveAccounts = async (scope: ChatScope, accounts: ProviderAccountMap): Promise<boolean> => {
    try {
        useProviderAccountsStore.getState().set(scope.id, await linkTo(scope).request('accounts.save', { accounts }));
        return true;
    } catch (e) {
        chatHost().notify({ id: `providers-save-${scope.id}`, kind: 'error', title: words('account.saveFailed'), description: reason(e) });
        return false;
    }
};

/* One account changed and every other one as the host last said. */
export const saveAccount = (scope: ChatScope, id: string, account: ProviderAccount): Promise<boolean> => {
    const current = providerAccountsOf(scope.id).accounts?.accounts ?? {};
    return saveAccounts(scope, { ...current, [id]: account });
};

/*
 * Forgets an account; its folder stays where it is. A pick for new agents that named it goes back to
 * the CLI's default account, since no chat started from it yet.
 */
export const removeAccount = async (scope: ChatScope, id: string, kind: AgentKind): Promise<void> => {
    const { [id]: _gone, ...rest } = providerAccountsOf(scope.id).accounts?.accounts ?? {};
    if (!(await saveAccounts(scope, rest))) {
        throw new Error(words('account.saveFailed'));
    }
    if (accountFor(readChatPreferences(), scope.id, kind) === id) {
        rememberChatAccount(scope.id, kind, null);
    }
};

/* An account in a folder the host makes for it; answers its id. Throws what the host said, for the form to show. */
export const createAccount = async (scope: ChatScope, kind: AgentKind, label: string, color: string): Promise<string> => {
    const created = await linkTo(scope).request('accounts.create', { kind, label, color });
    const { id, ...accounts } = created;
    useProviderAccountsStore.getState().set(scope.id, accounts);
    return id;
};

/* An account in a folder that is already on the host. Throws what the host said, for the form to show. */
export const linkAccount = async (scope: ChatScope, id: string, account: ProviderAccount): Promise<void> => {
    const current = providerAccountsOf(scope.id).accounts?.accounts ?? {};
    useProviderAccountsStore.getState().set(scope.id, await linkTo(scope).request('accounts.save', { accounts: { ...current, [id]: account } }));
};
