import type { Subprocess } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { peerStatementMessage, type PeerStatement } from '@ruimte/pulsar';
import { AuthStore } from '../../auth/auth-store.ts';
import { Handshake } from '../../auth/handshake.ts';
import { generateKeyPair, signMessage } from '../../auth/keys.ts';
import { connectionOpener } from '../../connection.ts';
import { Dispatcher } from '../../dispatcher.ts';
import { BrokerRelay } from '../../pulsar/broker-relay.ts';
import { authenticateChannel } from '../../pulsar/channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS, type DirectChannel } from '../../pulsar/data-channel.ts';
import { DirectPeers } from '../../pulsar/peers.ts';
import { SignalGate } from '../../pulsar/signal-gate.ts';
import { StatementGate } from '../../pulsar/statement.ts';
import { hostWith } from '../../pulsar/test-helpers.ts';
import { waitFor } from '../../sessions/test-helpers.ts';
import type { ClientAccess } from '../../wire.ts';
import { PeerKey } from './peer-key.ts';
import { PeerMachines } from './peer-machines.ts';
import { PendingAdmissions } from './pending-admissions.ts';
import { RemoteConnections, brokerDialer } from './remote-connections.ts';
import { RemoteStatus } from './remote-status.ts';
import { startBroker } from './test-helpers.ts';

/*
 * Both machines in one process: B the way `network.ts` wires it (the relay on a real broker, the gate
 * that takes peer statements, the handshake, a dispatcher with a peer list), A with the production
 * dialer. A real broker runs beside them in its own process, so the signals take the road they take
 * in production and the channel is real ICE, DTLS and SCTP on loopback.
 */

const MACHINE_ID = 'machine-b';
const addressBook = generateKeyPair();
const machineKey = generateKeyPair();

let brokerUrl: string;
let broker: Subprocess;
let homeA: string;
let homeB: string;
let store: AuthStore;
let peers: DirectPeers;
let relay: BrokerRelay;
let peerKey: PeerKey;
let machines: PeerMachines;
let pending: PendingAdmissions;
let status: RemoteStatus;
let connections: RemoteConnections;
const opened: Array<{ channel: DirectChannel; access: ClientAccess }> = [];
const heard: string[] = [];

beforeAll(async () => {
    ({ broker, url: brokerUrl } = await startBroker());

    homeA = await mkdtemp(join(tmpdir(), 'ruimte-peer-a-'));
    homeB = await mkdtemp(join(tmpdir(), 'ruimte-peer-b-'));

    store = new AuthStore(homeB);
    const identity = { id: MACHINE_ID, publicKey: machineKey.publicKey, sign: (message: string) => signMessage(machineKey.privateKey, message) };
    const handshake = new Handshake(store, identity);
    const dispatcher = new Dispatcher();
    dispatcher.register('server.ping', () => ({ time: Date.now() }), { peer: true });
    dispatcher.register('fs.read', () => ({}) as never);
    dispatcher.register('peer.result', () => ({ status: 'done', result: 'not a result', bundle: null }) as never, { peer: true });
    const openConnection = connectionOpener(hostWith(dispatcher));
    peers = new DirectPeers({
        iceServers: () => [],
        portRange: null,
        hostAddresses: [],
        attemptTimeoutMs: 15_000,
        log: { log: () => undefined, warn: () => undefined },
        authenticate: (channel, binding) =>
            authenticateChannel({ channel, binding, handshake, daemonId: MACHINE_ID, localSecret: 'unused', reachability: 'public', timeoutMs: 10_000 }),
        open: (channel, access) => {
            opened.push({ channel, access });
            const connection = openConnection(channel, access);
            channel.receiveWith((frame) => connection.receive(frame), AUTHENTICATED_FRAME_CHARS);
        }
    });
    const statements = new StatementGate({
        machineId: MACHINE_ID,
        machinePublicKey: machineKey.publicKey,
        trustedKeys: [addressBook.publicKey],
        store,
        log: { log: () => undefined, warn: () => undefined }
    });
    const gate = new SignalGate({
        publicKey: machineKey.publicKey,
        isPaired: async (publicKey) => (await store.sessionForPublicKey(publicKey)) !== null,
        admitStatement: (publicKey, access) => statements.admit(publicKey, access),
        receive: (envelope, reply) => peers.receive(envelope, reply),
        log: { warn: () => undefined }
    });
    relay = new BrokerRelay({
        url: brokerUrl,
        publicKey: machineKey.publicKey,
        sign: identity.sign,
        gate,
        log: { log: () => undefined, warn: () => undefined }
    });
    await relay.publish();
    await relay.whenReady();
}, 60_000);

let fixture = 0;

beforeEach(async () => {
    fixture += 1;
    heard.length = 0;
    peerKey = new PeerKey(join(homeA, String(fixture)));
    machines = new PeerMachines(join(homeA, String(fixture)));
    pending = new PendingAdmissions();
    status = new RemoteStatus();
    status.subscribe('client', (event) => {
        if (event.event === 'remote.status') {
            heard.push(event.payload.state);
        }
    });
    connections = new RemoteConnections({
        machines,
        pending,
        status,
        owed: () => 0,
        unstarted: () => [],
        dialer: brokerDialer({ signer: peerKey, defaultBroker: () => brokerUrl, label: () => 'Studio', timeoutMs: 15_000 })
    });
    await machines.put({ machineId: MACHINE_ID, publicKey: machineKey.publicKey }, Date.now());
});

afterEach(() => {
    connections.closeAll();
});

afterAll(async () => {
    connections.closeAll();
    await relay.stop();
    peers.closeAll();
    broker.kill();
    await rm(homeA, { recursive: true, force: true });
    await rm(homeB, { recursive: true, force: true });
});

async function statement(nonce: string): Promise<PeerStatement> {
    const peerPublicKey = await peerKey.publicKey();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 600_000;
    const fields = [MACHINE_ID, machineKey.publicKey, 'owner', peerPublicKey, 'machine-a', generateKeyPair().publicKey, nonce, issuedAt, expiresAt] as const;
    return {
        machineId: MACHINE_ID,
        machinePublicKey: machineKey.publicKey,
        accountId: 'owner',
        peerPublicKey,
        peerMachineId: 'machine-a',
        peerMachinePublicKey: fields[5],
        nonce,
        issuedAt,
        expiresAt,
        signature: signMessage(addressBook.privateKey, peerStatementMessage(...fields))
    };
}

async function admitPeer(): Promise<void> {
    pending.hold(await statement(`admit-${fixture}`.padEnd(22, 'n')));
    await connections.connect(MACHINE_ID);
    expect(pending.peek(MACHINE_ID)).toBeNull();
    connections.closeAll();
}

describe('the link of one machine to another, over a real broker', () => {
    test('opens on a peer statement, asks the peer list and nothing else, and drops the statement once it was used', async () => {
        pending.hold(await statement('first-link-nonce'.padEnd(22, 'n')));
        const link = await connections.connect(MACHINE_ID);
        expect(heard).toEqual(['connecting', 'open']);
        expect(pending.peek(MACHINE_ID)).toBeNull();
        expect(opened.at(-1)?.access.peer).toEqual({ machineId: 'machine-a' });
        await expect(link.request('server.ping', {})).resolves.toMatchObject({ time: expect.any(Number) });
        await expect(link.request('fs.read', { path: '/etc/passwd' })).rejects.toMatchObject({ code: 'forbidden' });
        // A machine that lies about what it answers is not believed.
        await expect(link.request('peer.result', { nodeId: 'chat-one' })).rejects.toThrow(/not an answer to it/);
    }, 60_000);

    test('opens again on the peer key alone once the machine let it in', async () => {
        await admitPeer();
        const link = await connections.connect(MACHINE_ID);
        await expect(link.request('server.ping', {})).resolves.toBeDefined();
    }, 60_000);

    test('notices when the other machine closes the channel, and is refused once its key was revoked', async () => {
        await admitPeer();
        await connections.connect(MACHINE_ID);
        const lost: string[] = [];
        connections.onLost((machineId) => lost.push(machineId));
        const sessionId = (await store.sessionForPublicKey(await peerKey.publicKey()))!;
        await store.revoke(sessionId);
        opened.at(-1)!.channel.close(4001, 'Access revoked');
        await waitFor(() => lost.length > 0, 'the link to notice', 15_000);
        expect(connections.isOpen(MACHINE_ID)).toBe(false);

        await expect(connections.connect(MACHINE_ID)).rejects.toThrow();
        pending.hold(await statement('after-revoke-nonce'.padEnd(22, 'n')));
        await expect(connections.connect(MACHINE_ID)).rejects.toThrow();
        expect(connections.isOpen(MACHINE_ID)).toBe(false);
    }, 90_000);
});
