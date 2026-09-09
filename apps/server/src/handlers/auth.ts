import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { AuthStore } from '../auth/auth-store.ts';

export interface EndpointIdentity {
    label: string;
    version: string;
    // Mints a one-time pairing URL; what `ruimte pair` and the settings dialog hand to another machine.
    pairingUrl(): string;
    // Revoking must take effect now, not at the next connection, so the daemon drops that session's sockets here.
    disconnect(sessionId: string): void;
}

export const registerAuthHandlers = (dispatcher: Dispatcher, store: AuthStore, identity: EndpointIdentity): void => {
    dispatcher.register('endpoint.info', (_payload, client) => ({
        label: identity.label,
        platform: process.platform,
        version: identity.version,
        reachability: client.access?.reachability ?? 'loopback',
        authenticated: client.access?.sessionId !== null && client.access?.sessionId !== undefined
    }));

    dispatcher.register('auth.sessions', async (_payload, client) => ({ sessions: await store.list(client.access?.sessionId ?? null) }));

    dispatcher.register('auth.pairingToken', (_payload, client) => {
        // Same rule as the HTTP route: only something on the daemon's own machine may invite another one.
        if ((client.access?.reachability ?? 'loopback') !== 'loopback') {
            throw new RequestError('forbidden', "Only a client on the daemon's own machine can make a pairing link");
        }
        return { url: identity.pairingUrl() };
    });

    dispatcher.register('auth.revoke', async (payload) => {
        if (!(await store.revoke(payload.id))) {
            throw new RequestError('session-not-found', `No paired client ${payload.id}`);
        }
        identity.disconnect(payload.id);
        return {};
    });
};
