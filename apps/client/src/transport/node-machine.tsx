import { useMemo, type ReactElement, type ReactNode } from 'react';
import { endpointIdIn, useEndpoints } from '@/state/endpoints';
import { machineIn, type Connection } from './connections';
import { ConnectionProvider } from './ConnectionProvider';
import { useOptionalConnection } from './context';

/*
 * What a node under it reads of its machine. A node that runs on another machine gets that machine's
 * transport and its session, chat, browser and device clients, so its rows, its requests and its
 * prompts are the ones of the machine it runs on. The document stays the workspace's: the project,
 * the drawings and the diagrams are still the ones on the machine the project lives on.
 */
export function NodeMachineScope({ machine, children }: { machine: string | undefined; children: ReactNode }): ReactElement {
    const workspace = useOptionalConnection();
    const endpoints = useEndpoints((state) => state.endpoints);
    // A node names its machine by the daemon's id, and this client keys the machine on its row.
    const endpointId = machine === undefined ? undefined : endpointIdIn(endpoints, machine);
    const own = endpointId === undefined || workspace === null || endpointId === workspace.endpointId;
    const remote = own ? null : machineIn(endpoints, endpointId);
    const connection = useMemo<Connection | null>(
        () =>
            remote === null || workspace === null
                ? null
                : {
                      endpointId: remote.endpointId,
                      transport: remote.transport,
                      sessions: remote.sessions,
                      chats: remote.chats,
                      browsers: remote.browsers,
                      devices: remote.devices,
                      projects: workspace.projects,
                      drawings: workspace.drawings,
                      diagrams: workspace.diagrams
                  },
        [remote, workspace]
    );
    // A machine this client does not know has nothing to draw the node from. The frame says so in place of the body (`RemoteNodeOffline`), so nothing under it starts work on the wrong machine.
    return connection === null ? <>{children}</> : <ConnectionProvider connection={connection}>{children}</ConnectionProvider>;
}
