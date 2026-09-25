import i18next from 'i18next';
import type { AgentKind, ProviderAccount, ProviderAccountMap } from '@ruimte/contracts';
import { createNodeAction } from '@/actions/client-actions';
import { accountFor, readChatPreferences, rememberChatAccount } from '@/chat/preferences';
import { providerAccountsOf, useProviderAccountsStore } from '@/state/provider-accounts';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';

const words = (key: string, values?: Record<string, string>): string => i18next.t(`settings:providers.${key}`, values);

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const linkTo = (endpointId: string) => {
    const link = transportFor(endpointId);
    if (link === null) {
        throw new Error(i18next.t('settings:machine.notAnswering'));
    }
    return link;
};

/* The whole map, as `accounts.save` takes it. Answers false when the machine refused, which a toast then says. */
export const saveAccounts = async (endpointId: string, accounts: ProviderAccountMap): Promise<boolean> => {
    try {
        useProviderAccountsStore.getState().set(endpointId, await linkTo(endpointId).request('accounts.save', { accounts }));
        return true;
    } catch (e) {
        useToasts.getState().show({ id: `providers-save-${endpointId}`, kind: 'error', title: words('account.saveFailed'), description: reason(e) });
        return false;
    }
};

/* One account changed and every other one as the machine last said. */
export const saveAccount = (endpointId: string, id: string, account: ProviderAccount): Promise<boolean> => {
    const current = providerAccountsOf(endpointId).accounts?.accounts ?? {};
    return saveAccounts(endpointId, { ...current, [id]: account });
};

/*
 * Forgets an account; its folder stays where it is. A pick for new agents that named it goes back to
 * the CLI's default account, since no chat started from it yet.
 */
export const removeAccount = async (endpointId: string, id: string, kind: AgentKind): Promise<void> => {
    const { [id]: _gone, ...rest } = providerAccountsOf(endpointId).accounts?.accounts ?? {};
    if (!(await saveAccounts(endpointId, rest))) {
        throw new Error(words('account.saveFailed'));
    }
    if (accountFor(readChatPreferences(), endpointId, kind) === id) {
        rememberChatAccount(endpointId, kind, null);
    }
};

/* An account in a folder the machine makes for it; answers its id. Throws what the machine said, for the form to show. */
export const createAccount = async (endpointId: string, kind: AgentKind, label: string, color: string): Promise<string> => {
    const created = await linkTo(endpointId).request('accounts.create', { kind, label, color });
    const { id, ...accounts } = created;
    useProviderAccountsStore.getState().set(endpointId, accounts);
    return id;
};

/* An account in a folder that is already on the machine. Throws what the machine said, for the form to show. */
export const linkAccount = async (endpointId: string, id: string, account: ProviderAccount): Promise<void> => {
    const current = providerAccountsOf(endpointId).accounts?.accounts ?? {};
    useProviderAccountsStore.getState().set(endpointId, await linkTo(endpointId).request('accounts.save', { accounts: { ...current, [id]: account } }));
};

/*
 * Opens a terminal node on the canvas on screen that runs the CLI's own login in the account's
 * environment, then has the machine watch for the login to land. The settings and the usage page
 * close, so the terminal is what the person sees. A person making the node is what approves its command.
 */
export const openLogin = async (endpointId: string, kind: AgentKind, id: string, name: string): Promise<void> => {
    const command = providerAccountsOf(endpointId).accounts?.loginCommands?.[kind];
    if (command === undefined) {
        return;
    }
    const nodeId = await createNodeAction('terminal', { provider: kind, account: id, command, title: words('account.login.nodeTitle', { account: name }) });
    if (nodeId === null) {
        useToasts.getState().show({ kind: 'error', title: words('account.login.failed'), description: words('account.login.needsCanvas') });
        return;
    }
    useUi.getState().setSettings({ open: false });
    useUi.getState().setUsageOpen(false);
    // Watching is a courtesy: the status still arrives on the machine's own clock.
    void transportFor(endpointId)
        ?.request('accounts.watchLogin', { id })
        .catch(() => undefined);
};
