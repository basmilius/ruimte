import { externalActorId, type ConnectedClient } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import { isOwner } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { ConnectedClients } from '../clients/connected-clients.ts';
import type { ActiveClient } from '../tunnels/credential-store.ts';

export interface ClientDeps {
    connected: ConnectedClients;
    auth: Pick<AuthStore, 'list'>;
    /* The external MCP clients that made a request lately. */
    external(): ActiveClient[];
}

function externalClient({ credentialId, client, lastUsedAt }: ActiveClient): ConnectedClient {
    return {
        id: externalActorId(credentialId),
        access: 'mcp',
        label: client,
        client: 'mcp',
        connectedAt: lastUsedAt,
        lastRequestAt: lastUsedAt,
        current: false
    };
}

/*
 * Who is connected now. None of these is on a peer's list; any client a machine let in may ask, as with `auth.sessions`.
 * External MCP clients are the owner's alone to see, as their credentials are (`credential.list`). Every channel is
 * listed while it is open, another machine's included, which hears no change of the list.
 */
export function clientArea({ connected, auth, external }: ClientDeps): Area {
    return {
        name: 'client',
        sources: [connected],
        opened: (clientId, access) => connected.opened(clientId, access),
        closed: (clientId) => connected.closed(clientId),
        handlers: (dispatcher) => {
            dispatcher.register('client.list', async (_payload, client) => {
                const labels = new Map((await auth.list(null)).map((session) => [session.id, session.label]));
                const clients = connected.list(client.id, (sessionId) => labels.get(sessionId));

                return {
                    clients: isOwner(client.access) ? [...clients, ...external().map(externalClient)] : clients
                };
            });

            dispatcher.register('client.watch', (_payload, client) => {
                // A channel that went while this was on its way would leave a watch nobody hears.
                if (client.closed !== true) {
                    connected.watch(client.id);
                }

                return {};
            });

            dispatcher.register('client.unwatch', (_payload, client) => {
                connected.unwatch(client.id);

                return {};
            });
        }
    };
}
