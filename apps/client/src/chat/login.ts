import { providerAccountsOf } from '@adecore/agents-react/state';
import type { AgentKind } from '@ruimte/contracts';
import { useUi } from '@/state/ui';

/*
 * Runs the CLI's own login in the account's environment, in a dialog over whatever asked (the settings,
 * the onboarding, the usage page), so it never depends on a workspace or a canvas being on screen.
 */
export async function openLogin(endpointId: string, kind: AgentKind, id: string, name: string): Promise<void> {
    if (providerAccountsOf(endpointId).accounts?.loginCommands?.[kind] === undefined) {
        return;
    }
    useUi.getState().setLogin({ endpointId, kind, accountId: id, name });
}
