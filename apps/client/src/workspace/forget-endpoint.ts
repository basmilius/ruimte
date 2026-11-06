import { useChats, useProviderAccountsStore, useProvidersStore, useUsageStore } from '@adecore/agents-react/state';
import { useBrowser } from '@/clients/browser/registry';
import { dropClientLocalOf } from '@/clients/project/client-local';
import { forgetCachedList } from '@/clients/project/list';
import { useEndpoints } from '@/state/endpoints';
import { isOfEndpoint } from '@/state/keys';
import { useLastSeen } from '@/state/last-seen';
import { useProcesses, useProcessWarnings } from '@/state/processes';
import { useProjectList } from '@/state/project-list';
import { useServers } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { browserStorage } from '@/state/stored-json';
import { fireAndForget } from '@/transport-api/transport';
import { pool } from '@/transport/index';
import { dropMachine, leaveWorkspace, showStart } from '@/workspace/connections';
import { windowWorkspace } from '@/workspace/window';
import { forgetTicket } from '../transport-api/credentials';

/* Forgetting the machine the open project is on takes the window back to the start screen first, so nothing is left on a daemon nothing talks to. */
export async function forgetEndpoint(id: string): Promise<void> {
    if (windowWorkspace()?.connection.endpointId === id) {
        await fireAndForget('leaveWorkspace', leaveWorkspace());
        showStart();
    }
    useEndpoints.getState().remove(id);
    forgetTicket(id);
    dropMachine(id);
    pool.drop(id);
    forgetEndpointState(id);
}

/* Everything this client kept about a machine it no longer knows. */
function forgetEndpointState(id: string): void {
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
}
