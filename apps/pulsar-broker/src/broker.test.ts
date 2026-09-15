import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from 'node:crypto';
import {
    BrokerPeer,
    BrokerServerFrameSchema,
    brokerHelloMessage,
    signalMessage,
    type BrokerRole,
    type BrokerServerFrame,
    type SignalEnvelope
} from '@ruimte/pulsar';
import { Broker, CLOSE, type Peer, type PeerSocket } from './broker.ts';
import { DEFAULT_LIMITS, type BrokerLimits } from './config.ts';

interface TestKey {
    publicKey: string;
    privateKey: KeyObject;
}

const newKey = (): TestKey => {
    const pair = generateKeyPairSync('ed25519');
    return { publicKey: (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x, privateKey: pair.privateKey };
};

const signWith = (key: TestKey, message: string): string => sign(null, Buffer.from(message), key.privateKey).toString('base64url');

const verifies = (publicKey: string, message: string, signature: string): boolean =>
    verify(
        null,
        Buffer.from(message),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    );

// The broker schedules nothing and signing is synchronous, so one turn of the event loop settles every exchange.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const BROKER_NAME = 'broker.example.com';

class FakeSocket implements PeerSocket {
    readonly sent: BrokerServerFrame[] = [];
    pings = 0;
    closed: number | null = null;
    onFrame: ((frame: string) => void) | null = null;

    send(frame: string): void {
        this.sent.push(JSON.parse(frame) as BrokerServerFrame);
        this.onFrame?.(frame);
    }

    close(code: number): void {
        this.closed = code;
    }

    ping(): void {
        this.pings += 1;
    }
}

/* A broker on a clock that stands still, so no rate limit refills halfway through a test. */
const newBroker = (limits: Partial<BrokerLimits> = {}): Broker => new Broker({ ...DEFAULT_LIMITS, ...limits }, () => 0);

let nextAddress = 1;

/* One peer on a fake socket, driven by the same `BrokerPeer` a daemon and a client use: every frame it hears, and how the socket closed. */
const connect = (broker: Broker, role: BrokerRole, key: TestKey, options: { signer?: TestKey; ip?: string } = {}) => {
    const socket = new FakeSocket();
    const handle: Peer = broker.open(socket, options.ip ?? `192.0.2.${nextAddress++}`, BROKER_NAME);
    const state = {
        frames: socket.sent,
        ready: false,
        get closed(): number | null {
            return socket.closed;
        }
    };
    const signer = options.signer ?? key;
    const peer = new BrokerPeer({
        role,
        publicKey: key.publicKey,
        host: BROKER_NAME,
        sign: (message) => signWith(signer, message),
        send: (frame) => broker.message(handle, frame),
        events: {
            ready: () => {
                state.ready = true;
            },
            relayed: () => undefined,
            refused: () => undefined,
            failed: () => undefined
        }
    });
    socket.onFrame = (frame) => {
        BrokerServerFrameSchema.parse(JSON.parse(frame));
        void peer.receive(frame);
    };
    peer.start();
    return { handle, socket, peer, state, key };
};

const offer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };
const answer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 BB' } };

const framesOf = <T extends BrokerServerFrame['type']>(state: { frames: BrokerServerFrame[] }, type: T): Extract<BrokerServerFrame, { type: T }>[] =>
    state.frames.filter((frame): frame is Extract<BrokerServerFrame, { type: T }> => frame.type === type);

describe('the broker between peers', () => {
    test('a machine and a client announce, and a signal travels both ways with the sender filled in', async () => {
        const broker = newBroker();
        const machine = connect(broker, 'machine', newKey());
        const client = connect(broker, 'client', newKey());
        await settle();
        expect(machine.state.ready && client.state.ready).toBe(true);
        expect(broker.counts).toEqual({ sockets: 2, machines: 1, clients: 1 });

        const offerId = await client.peer.relay(machine.key.publicKey, offer);
        await settle();
        const received = framesOf(machine.state, 'relayed');
        expect(received).toHaveLength(1);
        expect(received[0]!.from).toBe(client.key.publicKey);
        expect(received[0]!.envelope).toEqual(offer);
        // Untouched on the way, so the machine can check it against the client's key.
        expect(verifies(client.key.publicKey, signalMessage(client.key.publicKey, machine.key.publicKey, offer), received[0]!.signature)).toBe(true);
        expect(framesOf(client.state, 'delivered').some((frame) => frame.id === offerId)).toBe(true);

        await machine.peer.relay(client.key.publicKey, answer);
        await settle();
        expect(framesOf(client.state, 'relayed')).toHaveLength(1);
        expect(framesOf(client.state, 'relayed')[0]!.from).toBe(machine.key.publicKey);
        expect(framesOf(client.state, 'relayed')[0]!.envelope).toEqual(answer);
    });

    test('a wrong signature gets nothing: the socket closes and the key is not reachable', async () => {
        const broker = newBroker();
        const victim = newKey();
        const impostor = connect(broker, 'machine', victim, { signer: newKey() });
        await settle();
        expect(impostor.state.closed).toBe(CLOSE.badSignature);
        expect(framesOf(impostor.state, 'error').map((frame) => frame.code)).toEqual(['bad-signature']);
        expect(impostor.state.ready).toBe(false);

        const client = connect(broker, 'client', newKey());
        await settle();
        const id = await client.peer.relay(victim.publicKey, offer);
        await settle();
        expect(framesOf(client.state, 'error')).toEqual([expect.objectContaining({ code: 'not-connected', id })]);
        expect(broker.counts.machines).toBe(0);
    });

    test('a relay to a key nobody announced is refused with the id it was about', async () => {
        const broker = newBroker();
        const client = connect(broker, 'client', newKey());
        await settle();
        const id = await client.peer.relay(newKey().publicKey, offer);
        await settle();
        expect(framesOf(client.state, 'error')).toEqual([{ type: 'error', code: 'not-connected', message: 'Nobody with that key is connected', id: id! }]);
        expect(framesOf(client.state, 'delivered')).toEqual([]);
    });

    test('a client cannot reach another client, only a machine', async () => {
        const broker = newBroker();
        const first = connect(broker, 'client', newKey());
        const second = connect(broker, 'client', newKey());
        await settle();
        await first.peer.relay(second.key.publicKey, offer);
        await settle();
        expect(framesOf(first.state, 'error').map((frame) => frame.code)).toEqual(['not-connected']);
        expect(framesOf(second.state, 'relayed')).toEqual([]);
    });

    test('a second announcement of the same key replaces the first', async () => {
        const broker = newBroker();
        const key = newKey();
        const first = connect(broker, 'machine', key);
        await settle();
        expect(first.state.ready).toBe(true);
        const second = connect(broker, 'machine', key);
        await settle();
        expect(second.state.ready).toBe(true);
        expect(first.state.closed).toBe(CLOSE.replaced);
        expect(framesOf(first.state, 'error').map((frame) => frame.code)).toEqual(['replaced']);

        const client = connect(broker, 'client', newKey());
        await settle();
        await client.peer.relay(key.publicKey, offer);
        await settle();
        expect(framesOf(second.state, 'relayed')).toHaveLength(1);
        expect(framesOf(first.state, 'relayed')).toEqual([]);
        expect(broker.counts).toEqual({ sockets: 2, machines: 1, clients: 1 });
    });

    test('relays per key are limited, and the refusal says how long to wait', async () => {
        const broker = newBroker({ relaysPerMinutePerKey: 3 });
        const machine = connect(broker, 'machine', newKey());
        const client = connect(broker, 'client', newKey());
        await settle();
        const ids = [];
        for (let i = 0; i < 4; i++) {
            ids.push(await client.peer.relay(machine.key.publicKey, offer));
        }
        await settle();
        expect(framesOf(client.state, 'delivered')).toHaveLength(3);
        const limited = framesOf(client.state, 'rate-limited');
        expect(limited).toHaveLength(1);
        expect(limited[0]!.scope).toBe('key');
        expect(limited[0]!.id).toBe(ids[3]!);
        expect(limited[0]!.retryAfterMs).toBeGreaterThan(0);
        expect(limited[0]!.retryAfterMs).toBeLessThanOrEqual(20_000);
        expect(framesOf(machine.state, 'relayed')).toHaveLength(3);
    });

    test('frames per address are limited before they are parsed', async () => {
        const broker = newBroker({ framesPerSecondPerIp: 3 });
        const client = connect(broker, 'client', newKey());
        await settle();
        expect(client.state.ready).toBe(true);
        // Hello and prove spent two of three, so the second of these is over the limit.
        broker.message(client.handle, '{"type":"relay"}');
        broker.message(client.handle, '{"type":"relay"}');
        expect(framesOf(client.state, 'rate-limited').map((frame) => frame.scope)).toEqual(['ip']);
    });

    test('connections and sockets per address are limited at the upgrade', () => {
        const perMinute = newBroker({ connectionsPerMinutePerIp: 2 });
        expect(perMinute.admit('192.0.2.1')).toBeNull();
        expect(perMinute.admit('192.0.2.1')).toBeNull();
        expect(perMinute.admit('192.0.2.1')?.retryAfterMs).toBeGreaterThan(0);
        expect(perMinute.admit('192.0.2.2')).toBeNull();

        const perAddress = newBroker({ maxSocketsPerIp: 1 });
        const only = perAddress.open(new FakeSocket(), '192.0.2.1', BROKER_NAME);
        expect(perAddress.admit('192.0.2.1')?.message).toBe('Too many sockets from this address');
        perAddress.closed(only);
        expect(perAddress.admit('192.0.2.1')).toBeNull();
    });

    test('a key that announces too often is told to wait and closed', async () => {
        const broker = newBroker({ announcesPerMinutePerKey: 1 });
        const key = newKey();
        const first = connect(broker, 'machine', key);
        await settle();
        expect(first.state.ready).toBe(true);
        const second = connect(broker, 'machine', key);
        await settle();
        expect(second.state.closed).toBe(CLOSE.rateLimited);
        expect(framesOf(second.state, 'rate-limited')[0]!.scope).toBe('key');
        // The first stays: a flood of announcements is exactly what must not knock a machine off.
        expect(first.state.closed).toBeNull();
    });

    test('a frame over the size cap closes the socket', async () => {
        const broker = newBroker({ maxMessageBytes: 2048 });
        const client = connect(broker, 'client', newKey());
        await settle();
        broker.message(client.handle, 'x'.repeat(4096));
        expect(client.state.closed).toBe(CLOSE.tooLarge);
        expect(framesOf(client.state, 'relayed')).toEqual([]);
    });

    test('a relay before the signature and a frame that is not one end the socket', () => {
        const broker = newBroker();
        const socket = new FakeSocket();
        const peer = broker.open(socket, '192.0.2.1', BROKER_NAME);
        broker.message(peer, JSON.stringify({ type: 'relay', id: 'r1', to: newKey().publicKey, envelope: offer, signature: 's'.repeat(86) }));
        expect(socket.closed).toBe(CLOSE.badFrame);
        expect(socket.sent.map((frame) => frame.type)).toEqual(['error']);

        const other = new FakeSocket();
        broker.message(broker.open(other, '192.0.2.2', BROKER_NAME), 'not json');
        expect(other.closed).toBe(CLOSE.badFrame);
    });
});

describe('the broker without sockets', () => {
    const announce = (broker: Broker, socket: FakeSocket, key: TestKey) => {
        const peer = broker.open(socket, '192.0.2.1', BROKER_NAME);
        broker.message(peer, JSON.stringify({ type: 'hello', role: 'machine', publicKey: key.publicKey }));
        const challenge = socket.sent.at(-1) as Extract<BrokerServerFrame, { type: 'challenge' }>;
        expect(challenge.broker).toBe(BROKER_NAME);
        broker.message(
            peer,
            JSON.stringify({ type: 'prove', signature: signWith(key, brokerHelloMessage(BROKER_NAME, 'machine', key.publicKey, challenge.nonce)) })
        );
        return peer;
    };

    test('a socket that stops answering pings is dropped after two heartbeats, and one that answers stays', () => {
        let now = 0;
        const broker = new Broker({ ...DEFAULT_LIMITS, heartbeatMs: 1_000 }, () => now);
        const silent = new FakeSocket();
        const alive = new FakeSocket();
        const silentPeer = announce(broker, silent, newKey());
        const alivePeer = announce(broker, alive, newKey());
        expect(silent.sent.at(-1)).toEqual({ type: 'ready' });

        for (let step = 1; step <= 5; step++) {
            now = step * 1_000;
            broker.sweep();
            broker.heard(alivePeer);
        }
        expect(silent.pings).toBe(2);
        expect(silent.closed).toBe(CLOSE.timeout);
        expect(silentPeer.state).toBe('closed');
        expect(alive.closed).toBeNull();
        expect(alive.pings).toBe(5);
        expect(broker.counts).toEqual({ sockets: 1, machines: 1, clients: 0 });
    });

    test('a socket that never proves a key is dropped after the hello timeout', () => {
        let now = 0;
        const broker = new Broker({ ...DEFAULT_LIMITS, helloTimeoutMs: 500 }, () => now);
        const socket = new FakeSocket();
        broker.open(socket, '192.0.2.1', BROKER_NAME);
        now = 400;
        broker.sweep();
        expect(socket.closed).toBeNull();
        now = 600;
        broker.sweep();
        expect(socket.closed).toBe(CLOSE.timeout);
    });

    test('a nonce answers once: a second prove on the same socket is a bad frame', () => {
        const broker = new Broker(DEFAULT_LIMITS);
        const socket = new FakeSocket();
        const key = newKey();
        const peer = announce(broker, socket, key);
        broker.message(peer, JSON.stringify({ type: 'prove', signature: 's'.repeat(86) }));
        expect(socket.sent.at(-1)).toMatchObject({ type: 'error', code: 'bad-frame' });
        // Already announced, so the socket stays; only the frame was wrong.
        expect(socket.closed).toBeNull();
    });
});
