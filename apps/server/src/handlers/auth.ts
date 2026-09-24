import { PROTOCOL_VERSION } from '@ruimte/contracts';
import { RequestError, type ClientAccess, type Dispatcher } from '../dispatcher.ts';
import { mayInvite } from '../auth/access.ts';
import { signRegistration } from '../auth/registration.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { BrokerDescription } from '../pulsar/broker-switch.ts';

interface EndpointHost {
    identity: EndpointIdentity;
    version: string;
    // The broker clients are told to dial right now (null when this machine announces itself to none), and whether a flag decides it.
    broker(): BrokerDescription;
    // Mints a one-time pairing URL; what `ruimte pair` and the settings dialog hand to another machine.
    pairingUrl(): string;
    // Revoking must take effect now, not at the next connection, so the daemon drops that session's sockets here.
    disconnect(sessionId: string): void;
    // A disabled policy stops streams already in flight as well as refusing the next one.
    streamingChanged(allowed: boolean): void;
    // Chats take up a limited turn on a clock only while this is on; turning it off drops what was owed.
    resumeChanged?(on: boolean): void;
}

export const registerAuthHandlers = (dispatcher: Dispatcher, store: AuthStore, host: EndpointHost): void => {
    const { identity } = host;

    // Built per client, so what the machine is called travels alongside what this connection is allowed.
    const info = (access: ClientAccess | undefined) => ({
        id: identity.id,
        label: identity.label,
        nameSource: identity.nameSource,
        icon: identity.icon,
        agentsDeleteAnyView: identity.agentsDeleteAnyView,
        refuseStatements: identity.refuseStatements,
        streamingAllowed: identity.streamingAllowed,
        resumeAtReset: identity.resumeAtReset,
        platform: process.platform,
        version: host.version,
        protocol: PROTOCOL_VERSION,
        reachability: access?.reachability ?? 'loopback',
        authenticated: access?.sessionId !== null && access?.sessionId !== undefined,
        publicKey: identity.publicKey,
        broker: identity.broker,
        ...host.broker()
    });

    dispatcher.register('endpoint.info', (_payload, client) => info(client.access));

    /*
     * Any client that paired may name the machine. A name and an icon are how a person tells two
     * machines apart, so they belong to the machine and not to whichever client typed them.
     */
    dispatcher.register('endpoint.setIdentity', async (payload, client) => {
        await identity.setIdentity(payload.name, payload.icon, {
            agentsDeleteAnyView: payload.agentsDeleteAnyView,
            refuseStatements: payload.refuseStatements,
            streamingAllowed: payload.streamingAllowed,
            resumeAtReset: payload.resumeAtReset,
            broker: payload.broker
        });
        if (payload.streamingAllowed !== undefined) {
            host.streamingChanged(identity.streamingAllowed);
        }
        if (payload.resumeAtReset !== undefined) {
            host.resumeChanged?.(identity.resumeAtReset);
        }
        return info(client.access);
    });

    /*
     * The machine agreeing to be listed on one address book account. Any client that got in may ask,
     * since it already reaches everything the account would lead to; the client posts the answer with
     * its own session, so no account token ever reaches the daemon.
     */
    dispatcher.register('endpoint.signRegistration', (payload) => ({
        registration: signRegistration(identity, host.broker().brokerUrl, payload.accountId)
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
        if (!mayInvite(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can make a pairing link');
        }
        return { url: host.pairingUrl() };
    });

    dispatcher.register('auth.revoke', async (payload) => {
        if (!(await store.revoke(payload.id))) {
            throw new RequestError('session-not-found', `No paired client ${payload.id}`);
        }
        host.disconnect(payload.id);
        return {};
    });
};
