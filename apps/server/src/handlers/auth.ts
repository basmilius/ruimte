import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { AuthStore } from '../auth/auth-store.ts';

interface EndpointIdentity {
    id: string;
    label: string;
    version: string;
    // The daemon's ed25519 public key, so a client that paired before there were key pairs can pin it.
    publicKey: string;
    // Mints a one-time pairing URL; what `ruimte pair` and the settings dialog hand to another machine.
    pairingUrl(): string;
    // Revoking must take effect now, not at the next connection, so the daemon drops that session's sockets here.
    disconnect(sessionId: string): void;
}

export const registerAuthHandlers = (dispatcher: Dispatcher, store: AuthStore, identity: EndpointIdentity): void => {
    dispatcher.register('endpoint.info', (_payload, client) => ({
        id: identity.id,
        label: identity.label,
        platform: process.platform,
        version: identity.version,
        reachability: client.access?.reachability ?? 'loopback',
        authenticated: client.access?.sessionId !== null && client.access?.sessionId !== undefined,
        publicKey: identity.publicKey
    }));

    /*
     * The way over to a key pair for a client that paired when a session token was all there was.
     * It proves nothing beyond the connection it arrives on, which is exactly as much as the token
     * it already holds proves; what it buys is that the token stops being needed.
     */
    dispatcher.register('auth.registerKey', async (payload, client) => {
        const sessionId = client.access?.sessionId ?? null;
        if (sessionId === null) {
            return { registered: false };
        }
        return { registered: await store.registerKey(sessionId, payload.publicKey) };
    });

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
