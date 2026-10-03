import { PROTOCOL_VERSION, type MachineUpdate, type MachineUpdateReport, type MachineWork } from '@ruimte/contracts';
import { RequestError, translate, type ClientAccess, type Dispatcher } from '../dispatcher.ts';
import { mayInvite } from '../auth/access.ts';
import { signForAccount } from '../auth/registration.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { BrokerDescription } from '../pulsar/broker-switch.ts';
import type { InstallVerdict } from '../power/machine-update.ts';

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
    appleFoundationChanged?(on: boolean): Promise<void>;
    // Whether this machine can hold a block on sleep, and the call that follows a changed setting.
    keepAwake?: { available: boolean; changed(): void };
    // The update of the desktop app on this machine, and what installing it would end right now.
    updates?: {
        state(): MachineUpdate;
        report(clientId: string, report: MachineUpdateReport): void;
        requestInstall(): InstallVerdict;
        ending(): MachineWork;
    };
}

export const registerAuthHandlers = (dispatcher: Dispatcher, store: AuthStore, host: EndpointHost): void => {
    const { identity } = host;

    // Built per client, so what the machine is called travels alongside what this connection is allowed.
    const info = async (access: ClientAccess | undefined) => ({
        id: identity.id,
        label: identity.label,
        nameSource: identity.nameSource,
        icon: identity.icon,
        agentsDeleteAnyView: identity.agentsDeleteAnyView,
        refuseStatements: identity.refuseStatements,
        streamingAllowed: identity.streamingAllowed,
        resumeAtReset: identity.resumeAtReset,
        appleFoundationEnabled: identity.appleFoundationEnabled,
        ...identity.keepAwakeFields(),
        keepAwakeAvailable: host.keepAwake?.available === true,
        ...(host.updates ? { update: host.updates.state() } : {}),
        platform: process.platform,
        version: host.version,
        protocol: PROTOCOL_VERSION,
        reachability: access?.reachability ?? 'loopback',
        authenticated: access?.sessionId !== null && access?.sessionId !== undefined,
        publicKey: identity.publicKey,
        broker: identity.broker,
        ...host.broker(),
        // Only the app on this machine is told which account it is on; it is the one that can take it off.
        ...(mayInvite(access) ? { accountId: (await store.accountBinding())?.id ?? null } : {})
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
            appleFoundationEnabled: payload.appleFoundationEnabled,
            keepAwake: payload.keepAwake,
            keepAwakeOnBattery: payload.keepAwakeOnBattery,
            keepAwakeDisplay: payload.keepAwakeDisplay,
            broker: payload.broker
        });
        if (payload.keepAwake !== undefined || payload.keepAwakeOnBattery !== undefined || payload.keepAwakeDisplay !== undefined) {
            host.keepAwake?.changed();
        }
        if (payload.streamingAllowed !== undefined) {
            host.streamingChanged(identity.streamingAllowed);
        }
        if (payload.resumeAtReset !== undefined) {
            host.resumeChanged?.(identity.resumeAtReset);
        }
        if (payload.appleFoundationEnabled !== undefined) {
            await host.appleFoundationChanged?.(identity.appleFoundationEnabled);
        }
        return info(client.access);
    });

    /* Only the app on this machine holds the updater, so only the local secret may say where it stands. */
    dispatcher.register('endpoint.reportUpdate', (payload, client) => {
        if (!mayInvite(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can say where its update stands');
        }
        host.updates?.report(client.id, payload);
        return {};
    });

    /*
     * Any client may ask, a paired one included: it installs only a signed release of the app, and a
     * paired client can already stop every terminal and chat one by one. What it cannot do is end that
     * work unawares, so the first ask says what ends and only a second one with `confirm` installs.
     */
    dispatcher.register('endpoint.installUpdate', (payload) => {
        const updates = host.updates;
        if (!updates) {
            throw new RequestError('update-no-app', 'This machine cannot install an update from here');
        }
        const ending = updates.ending();
        if (!payload.confirm) {
            return { started: false, ending };
        }
        const verdict = updates.requestInstall();
        if (verdict === 'no-app') {
            throw new RequestError('update-no-app', 'The Ruimte app is not open on this machine; install the update there');
        }
        if (verdict === 'nothing') {
            throw new RequestError('update-none', 'There is no update to install on this machine');
        }
        return { started: true, ending };
    });

    /*
     * The machine agreeing to be listed on one address book account, which puts it on that account. Only
     * the app on this machine may ask: a machine is shared only with its owner, so a paired client must
     * not move it onto an account of its choosing. The client posts the answer with its own session, so
     * no account token ever reaches the daemon.
     */
    dispatcher.register('endpoint.signRegistration', async (payload, client) => {
        if (!mayInvite(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can put it on an account');
        }
        return {
            registration: await translate(() =>
                signForAccount(store, identity, host.broker().brokerUrl, payload.accountId, (sessionId) => host.disconnect(sessionId))
            )
        };
    });

    /* A person on this machine taking it off its account: every client a statement let in loses its access at once. */
    dispatcher.register('endpoint.leaveAccount', async (_payload, client) => {
        if (!mayInvite(client.access)) {
            throw new RequestError('forbidden', 'Only the app on this machine can take it off its account');
        }
        const revoked = await store.leaveAccount();
        revoked.forEach((sessionId) => host.disconnect(sessionId));
        return { revoked: revoked.length };
    });

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
