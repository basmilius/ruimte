import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../auth/auth-store.ts';
import { Handshake } from '../auth/handshake.ts';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { HIGH_WATER_MARK } from '../backpressure.ts';
import { connectionOpener, type ConnectionServices } from '../connection.ts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { authenticateChannel } from './channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS, type DirectChannel } from './data-channel.ts';
import { DirectClient, type DirectCredential } from './direct-client.ts';
import { DirectPeers } from './peers.ts';

/*
 * Both ends of a direct connection in one process, over real ICE, DTLS and SCTP on loopback: the
 * daemon's `DirectPeers` with the real handshake in front of a real dispatcher, and werift as the
 * client. The signals are handed across by a function, which is all the peers ever see of a socket.
 */

const DAEMON_ID = 'daemon-direct';
const LOCAL_SECRET = 'the-local-secret-of-this-home';
const daemonKey = generateKeyPair();

let home: string;
let store: AuthStore;
let handshake: Handshake;
let peers: DirectPeers;
const opened: Array<{ channel: DirectChannel; access: ClientAccess }> = [];
const logged: string[] = [];
const clients: DirectClient[] = [];

const noSource = { subscribe: () => () => undefined, detachAll: () => undefined };

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-direct-'));
    store = new AuthStore(home);
    handshake = new Handshake(store, { id: DAEMON_ID, publicKey: daemonKey.publicKey, sign: (message) => signMessage(daemonKey.privateKey, message) });
    const dispatcher = new Dispatcher();
    dispatcher.register('server.ping', (payload) => ({ ...payload, serverTime: Date.now() }) as never);
    dispatcher.register(
        'endpoint.info',
        (_payload, client) => ({ reachability: client.access?.reachability, authenticated: client.access?.sessionId !== null }) as never
    );
    const services = {
        dispatcher,
        sessions: { ...noSource, get: () => undefined },
        chats: noSource,
        identity: noSource,
        projects: noSource,
        drawings: noSource,
        diagrams: noSource,
        folders: noSource,
        statuses: noSource,
        usage: noSource,
        limits: noSource,
        processes: noSource
    } as unknown as ConnectionServices;
    const openConnection = connectionOpener(services);
    peers = new DirectPeers({
        iceServers: () => [],
        portRange: null,
        hostAddresses: [],
        attemptTimeoutMs: 10_000,
        log: { log: (...parts: unknown[]) => logged.push(parts.join(' ')), warn: (...parts: unknown[]) => logged.push(parts.join(' ')) },
        authenticate: (channel, binding) =>
            authenticateChannel({ channel, binding, handshake, daemonId: DAEMON_ID, localSecret: LOCAL_SECRET, reachability: 'lan', timeoutMs: 5_000 }),
        open: (channel, access) => {
            opened.push({ channel, access });
            const connection = openConnection(channel, access);
            channel.receiveWith((frame) => connection.receive(frame), AUTHENTICATED_FRAME_CHARS);
        }
    });
});

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.close();
    }
});

afterAll(async () => {
    peers.closeAll();
    await rm(home, { recursive: true, force: true });
});

const connect = (credential: DirectCredential, signal?: (client: DirectClient, envelope: Parameters<DirectPeers['receive']>[0]) => void): DirectClient => {
    const client: DirectClient = new DirectClient({
        stunServers: [],
        credential,
        timeoutMs: 10_000,
        signal: (envelope) => (signal ? signal(client, envelope) : peers.receive(envelope, (reply) => client.receiveSignal(reply)))
    });
    clients.push(client);
    return client;
};

const pairedKey = async () => {
    const paired = await store.pair(store.issuePairingToken(), { label: 'direct test' });
    const key = generateKeyPair();
    await store.registerKey(paired!.id, key.publicKey);
    return { ...key, sessionId: paired!.id };
};

describe('a direct connection', () => {
    test('a paired key passes the handshake and its requests reach the dispatcher', async () => {
        const key = await pairedKey();
        const client = connect({
            kind: 'key',
            publicKey: key.publicKey,
            privateKey: key.privateKey,
            daemonId: DAEMON_ID,
            daemonPublicKey: daemonKey.publicKey
        });
        const verdict = await client.open();
        expect(verdict.ticket).not.toBeNull();
        expect(opened.at(-1)?.access).toEqual({ reachability: 'lan', sessionId: key.sessionId });
        const info = await client.request<{ authenticated: boolean }>('endpoint.info', {});
        expect(info.authenticated).toBe(true);
    }, 20_000);

    test('the local secret passes without ever crossing the channel', async () => {
        const frames: string[] = [];
        const client = connect({ kind: 'secret', secret: LOCAL_SECRET, daemonId: DAEMON_ID });
        await client.open();
        client.onFrame((frame) => frames.push(frame));
        expect(opened.at(-1)?.access.sessionId).toBeNull();
        expect(frames.join('')).not.toContain(LOCAL_SECRET);
    }, 20_000);

    test('a key nobody paired, a wrong secret and a proof for another daemon get nothing', async () => {
        const stranger = generateKeyPair();
        const count = opened.length;
        await expect(
            connect({
                kind: 'key',
                publicKey: stranger.publicKey,
                privateKey: stranger.privateKey,
                daemonId: DAEMON_ID,
                daemonPublicKey: daemonKey.publicKey
            }).open()
        ).rejects.toThrow(/does not recognize/);
        await expect(connect({ kind: 'secret', secret: 'not-the-secret', daemonId: DAEMON_ID }).open()).rejects.toThrow(/not the secret/);
        const key = await pairedKey();
        await expect(
            connect({
                kind: 'key',
                publicKey: key.publicKey,
                privateKey: key.privateKey,
                daemonId: 'another-daemon',
                daemonPublicKey: daemonKey.publicKey
            }).open()
        ).rejects.toThrow();
        expect(opened.length).toBe(count);
    }, 40_000);

    test('a request sent in place of a proof is refused, not answered', async () => {
        const count = opened.length;
        // The refusal is the only frame that comes back; a reply to the request would fail the verdict's schema with its own text.
        await expect(connect({ kind: 'none' }).open()).rejects.toThrow(/^Expected a proof$/);
        expect(opened.length).toBe(count);
    }, 20_000);

    test('a signaling path that swaps the answer fingerprint breaks the handshake', async () => {
        const key = await pairedKey();
        const client = connect(
            { kind: 'key', publicKey: key.publicKey, privateKey: key.privateKey, daemonId: DAEMON_ID, daemonPublicKey: daemonKey.publicKey },
            (target, envelope) =>
                peers.receive(envelope, (reply) => {
                    if (reply.signal.kind !== 'answer') {
                        target.receiveSignal(reply);
                        return;
                    }
                    // Not a working man in the middle: it only proves the binding covers what the client applied.
                    const sdp = reply.signal.sdp.replace(
                        /(a=fingerprint:sha-256 )([0-9A-F]{2})/,
                        (_all: string, prefix: string, first: string) => `${prefix}${first === 'AA' ? 'BB' : 'AA'}`
                    );
                    target.receiveSignal({ ...reply, signal: { kind: 'answer', sdp } });
                })
        );
        await expect(client.open()).rejects.toThrow();
    }, 40_000);

    test('backpressure: a burst past the high-water mark is buffered and drains', async () => {
        const client = connect({ kind: 'secret', secret: LOCAL_SECRET, daemonId: DAEMON_ID });
        await client.open();
        const channel = opened.at(-1)!.channel;
        let drained = 0;
        channel.onDrain(() => {
            drained += 1;
        });
        let received = 0;
        client.onFrame((frame) => {
            received += frame.length;
        });
        const frame = JSON.stringify({ type: 'event', event: 'session.output', payload: { sessionId: 'burst', data: 'x'.repeat(40_000) } });
        let sent = 0;
        let peak = 0;
        while (sent < HIGH_WATER_MARK * 3) {
            expect(channel.send(frame)).toBe(frame.length);
            sent += frame.length;
            peak = Math.max(peak, channel.bufferedAmount());
        }
        expect(peak).toBeGreaterThan(HIGH_WATER_MARK);
        const deadline = Date.now() + 20_000;
        while (received < sent && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        expect(received).toBe(sent);
        expect(drained).toBeGreaterThanOrEqual(1);
    }, 40_000);

    test('the daemon logs a direct connection opening and ending, with the reason', async () => {
        const client = connect({ kind: 'secret', secret: LOCAL_SECRET, daemonId: DAEMON_ID });
        await client.open();
        const tag = client.connectionId.slice(0, 8);
        expect(logged.some((line) => line.includes(tag) && line.includes('opened'))).toBe(true);
        client.close();
        const deadline = Date.now() + 15_000;
        while (!logged.some((line) => line.includes(tag) && line.includes('ended')) && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        const ended = logged.find((line) => line.includes(tag) && line.includes('ended'));
        expect(ended).toMatch(/ended: (the channel closed|the peer connection closed|ICE failed)/);
    }, 20_000);

    test('an attempt that times out is logged with that reason', async () => {
        const connectionId = `silent-${Date.now()}`;
        const quick = new DirectPeers({
            iceServers: () => [],
            portRange: null,
            hostAddresses: [],
            attemptTimeoutMs: 300,
            log: { log: (...parts: unknown[]) => logged.push(parts.join(' ')), warn: (...parts: unknown[]) => logged.push(parts.join(' ')) },
            authenticate: async () => null,
            open: () => undefined
        });
        const offerer = new DirectClient({
            stunServers: [],
            credential: { kind: 'none' },
            signal: (envelope) => quick.receive({ ...envelope, connectionId }, () => undefined)
        });
        clients.push(offerer);
        void offerer.open().catch(() => undefined);
        const deadline = Date.now() + 10_000;
        while (!logged.some((line) => line.includes(connectionId.slice(0, 8)) && line.includes('ended')) && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        expect(logged.find((line) => line.includes(connectionId.slice(0, 8)) && line.includes('ended'))).toMatch(/did not open in time/);
        expect(quick.size).toBe(0);
    }, 20_000);

    test('closing the client ends the attempt on the daemon', async () => {
        const client = connect({ kind: 'secret', secret: LOCAL_SECRET, daemonId: DAEMON_ID });
        await client.open();
        const channel = opened.at(-1)!.channel;
        let closed = false;
        let clientIce: string | null = null;
        channel.onClose(() => {
            closed = true;
            clientIce = client.iceState;
        });
        const before = peers.size;
        client.close();
        // Well inside the 30 s of ICE consent, so only the channel's own close can pass this.
        const deadline = Date.now() + 5_000;
        while (!closed && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        expect(closed).toBe(true);
        // The daemon heard it while the client's peer was still up, not by luck in a race with its teardown.
        expect(clientIce).not.toBe('closed');
        expect(peers.size).toBe(before - 1);
    }, 20_000);
});
