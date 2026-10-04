import { dropClientLocalOf } from '@/project/client-local';
import { browserStorage } from '@/project/last-project';
import { useBrowser } from '@/browser/registry';
import { forgetCachedList } from '@/project/list';
import { useChats } from '@ruimte/agents-react/state/chats';
import { isOfEndpoint } from '@/state/keys';
import { useLastSeen } from '@/state/last-seen';
import { useSnoozes } from '@/state/snooze';
import { useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { useProviderAccountsStore } from '@ruimte/agents-react/state/provider-accounts';
import { useProvidersStore } from '@ruimte/agents-react/state/providers';
import { useServers } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useUsageStore } from '@ruimte/agents-react/state/usage';
import { pool } from '@/transport';
import { dropMachine, leaveWorkspace, showStart } from '@/transport/connections';
import { windowWorkspace } from '@/state/window';
import { useProcesses, useProcessWarnings } from '@/state/processes';
import { forgetTicket } from './credentials';

/* Forgetting the machine the open project is on takes the window back to the start screen first, so nothing is left on a daemon nothing talks to. */
export const forgetEndpoint = async (id: string): Promise<void> => {
    if (windowWorkspace()?.connection.endpointId === id) {
        await leaveWorkspace().catch(() => undefined);
        showStart();
    }
    useEndpoints.getState().remove(id);
    forgetTicket(id);
    dropMachine(id);
    pool.drop(id);
    forgetEndpointState(id);
};

/* Everything this client kept about a machine it no longer knows. */
const forgetEndpointState = (id: string): void => {
    useProjectList.getState().forgetProjects(id);
    forgetCachedList(id);
    useSessions.getState().clear(id);
    useChats.getState().forgetWhere((key) => isOfEndpoint(key, id));
    useBrowser.getState().clear(id);
    useServers.getState().forget(id);
    useProvidersStore.getState().forget(id);
    useProviderAccountsStore.getState().forget(id);
    useUsageStore.getState().forget(id);
    useProcesses.getState().forget(id);
    useProcessWarnings.getState().forget(id);
    useLastSeen.getState().forget(id);
    useSnoozes.getState().forget(id);
    dropClientLocalOf(browserStorage(), id);
};
