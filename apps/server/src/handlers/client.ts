import { externalActorId, type ConnectedClient } from '@ruimte/contracts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { ConnectedClients } from '../clients/connected-clients.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ActiveClient } from '../tunnels/credential-store.ts';

interface ClientHandlersInput {
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

/* Who is connected now. None of these is on a peer's list; any client a machine let in may ask, as with `auth.sessions`. */
export function registerClientHandlers(dispatcher: Dispatcher, { connected, auth, external }: ClientHandlersInput): void {
    dispatcher.register('client.list', async (_payload, client) => {
        const labels = new Map((await auth.list(null)).map((session) => [session.id, session.label]));

        return {
            clients: [...connected.list(client.id, (sessionId) => labels.get(sessionId)), ...external().map(externalClient)]
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
