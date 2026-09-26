import i18next from 'i18next';
import type { AgentKind } from '@ruimte/contracts';
import { providerAccountsOf } from '@ruimte/agents-react/state/provider-accounts';
import { createNodeAction } from '@/actions/client-actions';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { transportFor } from '@/transport';

const words = (key: string, values?: Record<string, string>): string => i18next.t(`settings:providers.account.login.${key}`, values);

/* A login runs in a terminal node on a canvas of a project on this very machine, so any other machine's has to wait for one. */
export const useLoginBlocked = (endpointId: string): string | null => {
    const workspaceMachine = useWindow((s) => (s.content.kind === 'workspace' ? s.content.workspace.connection.endpointId : null));
    return workspaceMachine === endpointId ? null : words('needsProject');
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
    const nodeId = await createNodeAction('terminal', { provider: kind, account: id, command, title: words('nodeTitle', { account: name }) });
    if (nodeId === null) {
        useToasts.getState().show({ kind: 'error', title: words('failed'), description: words('needsCanvas') });
        return;
    }
    useUi.getState().setSettings({ open: false });
    useUi.getState().setUsageOpen(false);
    // Watching is a courtesy: the status still arrives on the machine's own clock.
    void transportFor(endpointId)
        ?.request('accounts.watchLogin', { id })
        .catch(() => undefined);
};
