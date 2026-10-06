import i18next from 'i18next';
import type { AgentKind } from '@ruimte/contracts';
import { providerAccountsOf } from '@adecore/agents-react/state/provider-accounts';
import { createNodeAction } from '@/actions/client-actions';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/state/window';
import { transportFor } from '@/transport';

function words(key: string, values?: Record<string, string>): string {
    return i18next.t(`settings:providers.account.login.${key}`, values);
}

/*
 * Runs the CLI's own login in the account's environment. With a workspace of that machine on screen it
 * is a terminal node on the canvas, and the settings and the usage page close, so the terminal is what
 * the person sees; a person making the node is what approves its command. Anywhere else it is a terminal
 * in a dialog of its own, over whatever is open, which watches the login itself.
 */
export async function openLogin(endpointId: string, kind: AgentKind, id: string, name: string): Promise<void> {
    const command = providerAccountsOf(endpointId).accounts?.loginCommands?.[kind];
    if (command === undefined) {
        return;
    }
    if (windowWorkspace()?.connection.endpointId !== endpointId) {
        useUi.getState().setLogin({ endpointId, kind, accountId: id, name });
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
}
