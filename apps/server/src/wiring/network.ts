import type { Area } from '../area.ts';
import { reachabilityOf } from '../auth/access.ts';
import type { ServerConfig } from '../config.ts';
import type { IdentityLanDoor } from '../endpoint-id.ts';
import { BrokerRelay } from '../pulsar/broker-relay.ts';
import { BrokerSwitch } from '../pulsar/broker-switch.ts';
import { authenticateChannel } from '../pulsar/channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS } from '../pulsar/data-channel.ts';
import { readTunnel } from '../pulsar/default-route.ts';
import { lanAddresses } from '../pulsar/lan-addresses.ts';
import { LanDoor } from '../pulsar/lan-door.ts';
import { DirectPeers } from '../pulsar/peers.ts';
import { ReachChecker } from '../pulsar/reach-check.ts';
import { SignalGate } from '../pulsar/signal-gate.ts';
import { StatementGate, TEST_STATEMENT_KEY_VARIABLE, trustedStatementKeys } from '../pulsar/statement.ts';
import { guardWeriftTurn } from '../pulsar/turn-guard.ts';
import { reportFatal } from '../telemetry/reporter.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';
import type { MachineBundle } from './machine.ts';

/* How a client away from this machine reaches it: a direct channel, signaled over the broker or the door on the local network. */
export interface NetworkBundle {
    peers: DirectPeers;
    /* The broker is the second way a signal reaches `peers`, next to `direct.signal` on a socket. */
    brokerSwitch: BrokerSwitch;
    lanDoor: LanDoor;
    /* Open unless a person closed it or `--no-lan` keeps it closed. */
    lanDoorWanted(): boolean;
    describeLanDoor: IdentityLanDoor['describe'];
    /* Whether other devices reach this machine, for `endpoint.reach` and `ruimte status`. */
    reach: ReachChecker;
}

export function wireNetwork(config: ServerConfig, compiled: boolean, machine: MachineBundle, later: Later<Pick<DaemonBundles, 'clients'>>): NetworkBundle {
    const { identity, auth, handshake, access } = machine;
    // A TURN server that restarts under an allocation must not take the daemon with it; any other crash is reported on the way out.
    guardWeriftTurn(process, console, (code, error) => void reportFatal(error).finally(() => process.exit(code)));
    // A direct channel gets its access from its own handshake, never from the socket its signals came over.
    const peers = new DirectPeers({
        // The broker's TURN credentials are asked for per attempt, since they expire and the broker can change.
        iceServers: () => [...config.stun.map((urls) => ({ urls })), ...brokerSwitch.iceServers()],
        portRange: config.directPorts,
        hostAddresses: config.directHostAddresses,
        authenticate: (channel, binding, remoteAddress) =>
            authenticateChannel({
                channel,
                binding,
                handshake,
                daemonId: identity.id,
                localSecret: access.localSecret,
                reachability: reachabilityOf(remoteAddress ?? '')
            }),
        open: (channel, channelAccess) => {
            const state = later.clients().addDirect(channel, channelAccess);
            if (state !== null) {
                channel.receiveWith((frame) => state.connection.receive(frame), AUTHENTICATED_FRAME_CHARS);
            }
        }
    });
    const statementKeys = trustedStatementKeys(process.env, compiled);
    if (statementKeys.length === 1 && statementKeys[0] === process.env[TEST_STATEMENT_KEY_VARIABLE]?.trim()) {
        console.warn(`Believing statements signed by the test key in ${TEST_STATEMENT_KEY_VARIABLE} instead of the address book`);
    }
    // What lets a key the machine does not know yet in on a statement from the address book, when the machine takes them.
    const statements = new StatementGate({
        machineId: identity.id,
        machinePublicKey: identity.publicKey,
        trustedKeys: statementKeys,
        store: auth
    });
    // One gate for the broker and the door on the local network, so an attempt belongs to the key that offered it on both.
    const gate = new SignalGate({
        publicKey: identity.publicKey,
        isPaired: async (publicKey) => (await auth.sessionForPublicKey(publicKey)) !== null,
        admitStatement: (publicKey, statementAccess) => statements.admit(publicKey, statementAccess),
        receive: (envelope, reply) => peers.receive(envelope, reply)
    });
    // The switch follows the machine's setting, so a client that changes it needs no restart here.
    const brokerSwitch = new BrokerSwitch({
        override: config.broker,
        advertise: config.brokerAdvertise,
        setting: () => identity.broker,
        relayFor: (url) =>
            new BrokerRelay({
                url,
                publicKey: identity.publicKey,
                sign: (message) => identity.sign(message),
                gate,
                onSettled: () => reach.brokerSettled()
            })
    });
    identity.attachBroker(brokerSwitch);

    // The addresses are read per answer, so a machine that moved to another network says so without a timer.
    const lanDoor = new LanDoor({
        port: config.lanPort,
        identity: { machineId: identity.id, publicKey: identity.publicKey, sign: (message) => identity.sign(message) },
        gate
    });
    const lanDoorWanted = (): boolean => !config.lanDoorOff && identity.lanDoor;
    const describeLanDoor: IdentityLanDoor['describe'] = () => {
        const port = lanDoor.port;
        return { lan: port === null ? null : { port, addresses: lanAddresses() }, lanDoorFixed: config.lanDoorOff };
    };
    identity.attachLanDoor({
        apply: () => {
            if (lanDoorWanted()) {
                lanDoor.start();
            } else {
                lanDoor.stop();
            }
        },
        describe: describeLanDoor
    });
    const reach = new ReachChecker({
        broker: () => ({ url: brokerSwitch.describe().brokerUrl, connected: brokerSwitch.isReady }),
        iceServers: () => [...config.stun.map((urls) => ({ urls })), ...brokerSwitch.grantedIceServers()],
        granted: () => brokerSwitch.grantedIceServers().length > 0,
        lanDoor: () => ({
            wanted: lanDoorWanted(),
            listening: lanDoor.port !== null,
            port: lanDoor.port ?? (config.lanPort === 0 ? null : config.lanPort),
            addresses: lanAddresses().length
        }),
        tunnel: () => readTunnel()
    });
    return { peers, brokerSwitch, lanDoor, lanDoorWanted, describeLanDoor, reach };
}

/* The direct channels close with `handlers/direct.ts`; the door and the broker are left after them. */
export function networkLifecycle({ lanDoor, brokerSwitch }: NetworkBundle): Area {
    return {
        name: 'door and broker',
        stop: [
            { phase: 'last', label: 'Stopping the local network door', run: () => lanDoor.stop() },
            { phase: 'last', label: 'Leaving the broker', run: () => brokerSwitch.stop() }
        ]
    };
}
