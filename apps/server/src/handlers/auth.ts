import { CodedError } from '@adecore/agents';
import {
    PROTOCOL_VERSION,
    type AgentIntegrationReport,
    type AgentIntegrationsResult,
    type EndpointInfoPayload,
    type EndpointSettings,
    type MachineUpdate,
    type MachineUpdateReport,
    type MachineWork,
    type TextModelChoice
} from '@ruimte/contracts';
import { peerAccessRequestMessage } from '@ruimte/pulsar';
import { INTEGRATION_KINDS, IntegrationsFixed, isIntegrationKind } from '../agents/integrations.ts';
import type { Area } from '../area.ts';
import { isOwner } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { signForAccount } from '../auth/registration.ts';
import type { LiveSink } from '../client-sinks.ts';
import { type Dispatcher } from '../dispatcher.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { prepareSettings, type SettingPatch } from '../machine-settings.ts';
import type { PeerKey } from '../peer/giver/peer-key.ts';
import { DEFAULT_ADMIN_PROMPT } from '../power/closed-lid.ts';
import type { InstallVerdict } from '../power/machine-update.ts';
import { gitBash } from '../pty/pty.ts';
import { countClient, countUsage, recordStartup, recordTiming } from '../stats/usage-stats.ts';
import type { ClientAccess } from '../wire.ts';

export interface AuthDeps {
    store: AuthStore;
    identity: EndpointIdentity;
    // The key another machine lets this one in under, signed with next to the machine key.
    peerKey: Pick<PeerKey, 'publicKey' | 'sign'>;
    // `$RUIMTE_HOME`, which a worktree folder may not sit in.
    home: string;
    version: string;
    // Revoking must take effect now, not at the next connection, so the daemon drops that session's sockets here.
    disconnect(sessionId: string): void;
    keepAwake: { available: boolean };
    closedLid: {
        available: boolean;
        rule(): Promise<boolean>;
        setRule(install: boolean, prompt: string): Promise<void>;
    };
    // What a person allowed in the CLIs' global settings, and the calls that read and change it.
    agentIntegrations: {
        summary(): AgentIntegrationsResult['summary'];
        files(): Promise<AgentIntegrationsResult['files']>;
        set(kind: (typeof INTEGRATION_KINDS)[number], on: boolean): Promise<AgentIntegrationReport[]>;
    };
    // What a client told of itself, for the list of connected clients.
    announce(clientId: string, payload: EndpointInfoPayload): void;
    // Throws when the machine cannot write short texts with this pick: its CLI, model or account is not there.
    validateTextModel(choice: TextModelChoice): Promise<void>;
    // The update of the desktop app on this machine, and what installing it would end right now.
    updates: {
        subscribe(clientId: string, sink: LiveSink): () => void;
        state(): MachineUpdate;
        report(clientId: string, report: MachineUpdateReport): void;
        requestInstall(): InstallVerdict;
        ending(): MachineWork;
    };
}

export const PAIRING_REMOVED = 'Pairing links are gone. Put this machine on your account with `ruimte login`, or from the Ruimte app on it.';

export function authArea(deps: AuthDeps): Area {
    return {
        name: 'auth',
        sources: [deps.identity, deps.updates],
        handlers: (dispatcher) => registerRequests(dispatcher, deps)
    };
}

function registerRequests(dispatcher: Dispatcher, host: AuthDeps): void {
    const { identity, store } = host;

    // Built per client, so what the machine is called travels alongside what this connection is allowed.
    const info = async (access: ClientAccess | undefined) => ({
        ...identity.snapshot(),
        keepAwakeAvailable: host.keepAwake.available,
        keepAwakeLidAvailable: host.closedLid.available,
        keepAwakeLidRule: host.closedLid.available ? await host.closedLid.rule() : false,
        update: host.updates.state(),
        platform: process.platform,
        version: host.version,
        protocol: PROTOCOL_VERSION,
        reachability: access?.reachability ?? 'loopback',
        authenticated: access?.sessionId !== null && access?.sessionId !== undefined,
        publicKey: identity.publicKey,
        // Only the app on this machine is told which account it is on; it is the one that can take it off.
        ...(isOwner(access)
            ? {
                  accountId: (await store.accountBinding())?.id ?? null,
                  ...identity.ownerSettings(),
                  ...(process.platform === 'win32' && gitBash() === null ? { gitBashMissing: true } : {})
              }
            : {})
    });

    /*
     * A peer is told who this machine is and which requests it may ask, and nothing else: no settings, no
     * addresses, no account. The three fields the schema requires beyond that say only what the peer can see anyway.
     */
    dispatcher.register(
        'endpoint.info',
        async (payload, client) => {
            countClient(client.access, payload.client);
            host.announce(client.id, payload);
            if (client.access?.peer !== undefined) {
                return {
                    id: identity.id,
                    label: identity.label,
                    platform: process.platform,
                    version: host.version,
                    protocol: PROTOCOL_VERSION,
                    reachability: client.access.reachability,
                    authenticated: true,
                    publicKey: identity.publicKey,
                    features: dispatcher.peerTypes()
                };
            }
            return { ...(await info(client.access)), features: dispatcher.types(), viewReferences: true };
        },
        { peer: true }
    );

    /* The checks of the settings both requests set; `write` keeps them, with or without a new name, and follows what changed. */
    const applySettings = async (
        settings: EndpointSettings,
        access: ClientAccess | undefined,
        write: (patch: SettingPatch) => Promise<void>
    ): Promise<void> => {
        await write(
            await prepareSettings(settings, {
                owner: isOwner(access),
                home: host.home,
                closedLid: host.closedLid,
                current: identity.settings(),
                validateTextModel: (choice) => host.validateTextModel(choice)
            })
        );
    };

    /*
     * Any client the machine let in may name it. A name and an icon are how a person tells two
     * machines apart, so they belong to the machine and not to whichever client typed them.
     */
    dispatcher.register('endpoint.setIdentity', async (payload, client) => {
        await applySettings(payload, client.access, (flags) => identity.setIdentity(payload.name, payload.icon, flags));
        return info(client.access);
    });

    dispatcher.register('endpoint.settings', async (payload, client) => {
        await applySettings(payload, client.access, (flags) => identity.setSwitches(flags));
        return info(client.access);
    });

    /*
     * Any client the machine let in may set it, like a name: the size is the machine's, so a node an
     * agent adds here matches what a person's click would make. No tool reaches it.
     */
    dispatcher.register('endpoint.setNodeSize', async (payload, client) => {
        await identity.setNodeSize(payload.kind, payload.size);
        return info(client.access);
    });

    /*
     * Any client the machine let in may set it, like a name: where browsing starts is a path on this
     * machine, so every client of it starts in the same place. No tool reaches it.
     */
    dispatcher.register('endpoint.setStartFolder', async (payload, client) => {
        await identity.setStartFolder(payload.folder);
        return info(client.access);
    });

    /*
     * Only a person on this Mac may give the daemon a way to turn sleep off, so only the local secret
     * asks; macOS then asks that person for an administrator. Removing turns sleep back on and, once the
     * rule is gone, the switch off with it.
     */
    dispatcher.register(
        'endpoint.closedLidRule',
        async (payload, client) => {
            const closedLid = host.closedLid;
            if (!closedLid.available) {
                throw new CodedError('closed-lid-unavailable', 'Only a Mac can stay awake with its lid closed');
            }
            await closedLid.setRule(payload.install, payload.prompt ?? DEFAULT_ADMIN_PROMPT[payload.install ? 'install' : 'remove']);
            return info(client.access);
        },
        { owner: true }
    );

    /*
     * What Ruimte writes into the CLIs' own settings is a person's call on this machine, so only the local
     * secret reads the files and changes the choice. A client the machine let in is not its owner.
     */
    dispatcher.register(
        'endpoint.agentIntegrations',
        async () => {
            const current = host.agentIntegrations;
            return { summary: current.summary(), files: await current.files() };
        },
        { owner: true }
    );

    dispatcher.register(
        'endpoint.setAgentIntegration',
        async (payload) => {
            const current = host.agentIntegrations;
            if (!isIntegrationKind(payload.provider)) {
                throw new CodedError('unknown-provider', `Ruimte writes no settings for ${payload.provider}`);
            }
            const report = await current.set(payload.provider, payload.on).catch((e: unknown) => {
                if (e instanceof IntegrationsFixed) {
                    throw new CodedError('integrations-fixed', 'This machine was started with agent status turned off');
                }
                throw e;
            });
            return { summary: current.summary(), report };
        },
        { owner: true }
    );

    /* Only the app on this machine knows when it started, and it asks once per start. */
    dispatcher.register(
        'usage.startup',
        (payload) => {
            recordStartup(payload.ms);
            return {};
        },
        { owner: true }
    );

    /* What only the app on this machine sees: a dictation, how its links went. Names come from a fixed list in the schema. */
    dispatcher.register(
        'usage.count',
        (payload) => {
            countUsage(payload.counter);
            return {};
        },
        { owner: true }
    );

    dispatcher.register(
        'usage.timing',
        (payload) => {
            recordTiming(payload.timing, payload.ms);
            return {};
        },
        { owner: true }
    );

    /* Only the app on this machine holds the updater, so only the local secret may say where it stands. */
    dispatcher.register(
        'endpoint.reportUpdate',
        (payload, client) => {
            host.updates.report(client.id, payload);
            return {};
        },
        { owner: true }
    );

    /*
     * Any client may ask, not only the owner: it installs only a signed release of the app, and any
     * client can already stop every terminal and chat one by one. What it cannot do is end that
     * work unawares, so the first ask says what ends and only a second one with `confirm` installs.
     */
    dispatcher.register('endpoint.installUpdate', (payload) => {
        const updates = host.updates;
        const ending = updates.ending();
        if (!payload.confirm) {
            return { started: false, ending };
        }
        const verdict = updates.requestInstall();
        if (verdict === 'no-app') {
            throw new CodedError('update-no-app', 'The Ruimte app is not open on this machine; install the update there');
        }
        if (verdict === 'nothing') {
            throw new CodedError('update-none', 'There is no update to install on this machine');
        }
        return { started: true, ending };
    });

    /*
     * The machine agreeing to be listed on one address book account, which puts it on that account. Only
     * the app on this machine may ask: a machine is shared only with its owner, so another client must
     * not move it onto an account of its choosing. The client posts the answer with its own session, so
     * no account token ever reaches the daemon.
     */
    dispatcher.register(
        'endpoint.signRegistration',
        async (payload) => ({
            registration: await signForAccount(store, identity, identity.describe().brokerUrl, payload.accountId, (sessionId) => host.disconnect(sessionId))
        }),
        { owner: true }
    );

    /*
     * Not owner-only: any client acts as a person here, and what it gets is a request the address book
     * still has to vouch for. It gives no access to this machine.
     */
    dispatcher.register('endpoint.signPeerAccess', async ({ machineId, nonce }) => {
        if (machineId === identity.id) {
            throw new CodedError('bad-request', 'A machine cannot work in itself');
        }
        const peerPublicKey = await host.peerKey.publicKey();
        const message = peerAccessRequestMessage(machineId, peerPublicKey, identity.id, nonce);
        return {
            peerMachineId: identity.id,
            peerPublicKey,
            peerSignature: await host.peerKey.sign(message),
            machineSignature: identity.sign(message)
        };
    });

    /* A person on this machine taking it off its account: every client a statement let in loses its access at once. */
    dispatcher.register(
        'endpoint.leaveAccount',
        async () => {
            const revoked = await store.leaveAccount();
            revoked.forEach((sessionId) => host.disconnect(sessionId));
            return { revoked: revoked.length };
        },
        { owner: true }
    );

    dispatcher.register('auth.sessions', async (_payload, client) => ({ sessions: await store.list(client.access?.sessionId ?? null) }));

    dispatcher.register('auth.revoke', async (payload) => {
        if (!(await store.revoke(payload.id))) {
            throw new CodedError('session-not-found', `No client ${payload.id} on this machine`);
        }
        host.disconnect(payload.id);
        return {};
    });
}
