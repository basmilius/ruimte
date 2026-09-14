import { afterEach, describe, expect, test } from 'bun:test';
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
import { Broker, CLOSE, type PeerSocket } from './broker.ts';
import { DEFAULT_LIMITS, type BrokerLimits } from './config.ts';
import { startBroker, type RunningBroker } from './server.ts';

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

const waitUntil = async (label: string, ready: () => boolean, timeoutMs = 3_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!ready()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};

const running: RunningBroker[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
    for (const socket of sockets.splice(0)) {
        socket.close();
    }
    for (const broker of running.splice(0)) {
        await broker.stop();
    }
});

const start = (limits: Partial<BrokerLimits> = {}): RunningBroker => {
    const broker = startBroker({ host: '127.0.0.1', port: 0, names: [], trustProxy: false, limits: { ...DEFAULT_LIMITS, ...limits } });
    running.push(broker);
    return broker;
};

/* One peer on a real socket: every frame it hears, and whether the socket closed. */
const connect = (broker: RunningBroker, role: BrokerRole, key: TestKey, signer: TestKey = key) => {
    const socket = new WebSocket(`ws://127.0.0.1:${broker.port}`);
    sockets.push(socket);
    const state = { frames: [] as BrokerServerFrame[], ready: false, closed: null as number | null };
    const peer = new BrokerPeer({
        role,
        publicKey: key.publicKey,
        host: `127.0.0.1:${broker.port}`,
        sign: (message) => signWith(signer, message),
        send: (frame) => socket.send(frame),
        events: {
            ready: () => {
                state.ready = true;
            },
            relayed: () => undefined,
            refused: () => undefined,
            failed: () => undefined
        }
    });
    socket.onopen = () => peer.start();
    socket.onmessage = (message) => {
        state.frames.push(BrokerServerFrameSchema.parse(JSON.parse(String(message.data))));
        void peer.receive(String(message.data));
    };
    socket.onclose = (event) => {
        state.closed = event.code;
    };
    return { socket, peer, state, key };
};

const offer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };
const answer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 BB' } };

const framesOf = <T extends BrokerServerFrame['type']>(state: { frames: BrokerServerFrame[] }, type: T): Extract<BrokerServerFrame, { type: T }>[] =>
    state.frames.filter((frame): frame is Extract<BrokerServerFrame, { type: T }> => frame.type === type);

describe('the broker over real sockets', () => {
    test('a machine and a client announce, and a signal travels both ways with the sender filled in', async () => {
        const broker = start();
        const machine = connect(broker, 'machine', newKey());
        const client = connect(broker, 'client', newKey());
        await waitUntil('both peers to be ready', () => machine.state.ready && client.state.ready);
        expect(broker.broker.counts).toEqual({ sockets: 2, machines: 1, clients: 1 });

        const offerId = await client.peer.relay(machine.key.publicKey, offer);
        await waitUntil('the offer to arrive', () => framesOf(machine.state, 'relayed').length === 1);
        const received = framesOf(machine.state, 'relayed')[0]!;
        expect(received.from).toBe(client.key.publicKey);
        expect(received.envelope).toEqual(offer);
        // Untouched on the way, so the machine can check it against the client's key.
        expect(verifies(client.key.publicKey, signalMessage(client.key.publicKey, machine.key.publicKey, offer), received.signature)).toBe(true);
        await waitUntil('the delivery note', () => framesOf(client.state, 'delivered').some((frame) => frame.id === offerId));

        await machine.peer.relay(client.key.publicKey, answer);
        await waitUntil('the answer to arrive', () => framesOf(client.state, 'relayed').length === 1);
        expect(framesOf(client.state, 'relayed')[0]!.from).toBe(machine.key.publicKey);
        expect(framesOf(client.state, 'relayed')[0]!.envelope).toEqual(answer);
    });

    test('a wrong signature gets nothing: the socket closes and the key is not reachable', async () => {
        const broker = start();
        const victim = newKey();
        const impostor = connect(broker, 'machine', victim, newKey());
        await waitUntil('the socket to close', () => impostor.state.closed !== null);
        expect(impostor.state.closed).toBe(CLOSE.badSignature);
        expect(framesOf(impostor.state, 'error').map((frame) => frame.code)).toEqual(['bad-signature']);
        expect(impostor.state.ready).toBe(false);

        const client = connect(broker, 'client', newKey());
        await waitUntil('the client to be ready', () => client.state.ready);
        const id = await client.peer.relay(victim.publicKey, offer);
        await waitUntil('the refusal', () => framesOf(client.state, 'error').length === 1);
        expect(framesOf(client.state, 'error')[0]).toMatchObject({ code: 'not-connected', id });
        expect(broker.broker.counts.machines).toBe(0);
    });

    test('a relay to a key nobody announced is refused with the id it was about', async () => {
        const broker = start();
        const client = connect(broker, 'client', newKey());
        await waitUntil('the client to be ready', () => client.state.ready);
        const id = await client.peer.relay(newKey().publicKey, offer);
        await waitUntil('the refusal', () => framesOf(client.state, 'error').length === 1);
        expect(framesOf(client.state, 'error')[0]).toEqual({ type: 'error', code: 'not-connected', message: 'Nobody with that key is connected', id: id! });
        expect(framesOf(client.state, 'delivered')).toEqual([]);
    });

    test('a client cannot reach another client, only a machine', async () => {
        const broker = start();
        const first = connect(broker, 'client', newKey());
        const second = connect(broker, 'client', newKey());
        await waitUntil('both clients to be ready', () => first.state.ready && second.state.ready);
        await first.peer.relay(second.key.publicKey, offer);
        await waitUntil('the refusal', () => framesOf(first.state, 'error').length === 1);
        expect(framesOf(first.state, 'error')[0]!.code).toBe('not-connected');
        expect(framesOf(second.state, 'relayed')).toEqual([]);
    });

    test('a second announcement of the same key replaces the first', async () => {
        const broker = start();
        const key = newKey();
        const first = connect(broker, 'machine', key);
        await waitUntil('the first to be ready', () => first.state.ready);
        const second = connect(broker, 'machine', key);
        await waitUntil('the first to be replaced', () => first.state.closed !== null && second.state.ready);
        expect(first.state.closed).toBe(CLOSE.replaced);
        expect(framesOf(first.state, 'error').map((frame) => frame.code)).toEqual(['replaced']);

        const client = connect(broker, 'client', newKey());
        await waitUntil('the client to be ready', () => client.state.ready);
        await client.peer.relay(key.publicKey, offer);
        await waitUntil('the offer at the second socket', () => framesOf(second.state, 'relayed').length === 1);
        expect(framesOf(first.state, 'relayed')).toEqual([]);
        expect(broker.broker.counts).toEqual({ sockets: 2, machines: 1, clients: 1 });
    });

    test('relays per key are limited, and the refusal says how long to wait', async () => {
        const broker = start({ relaysPerMinutePerKey: 3 });
        const machine = connect(broker, 'machine', newKey());
        const client = connect(broker, 'client', newKey());
        await waitUntil('both peers to be ready', () => machine.state.ready && client.state.ready);
        const ids = [];
        for (let i = 0; i < 4; i++) {
            ids.push(await client.peer.relay(machine.key.publicKey, offer));
        }
        await waitUntil(
            'three deliveries and a refusal',
            () => framesOf(client.state, 'delivered').length === 3 && framesOf(client.state, 'rate-limited').length === 1
        );
        const limited = framesOf(client.state, 'rate-limited')[0]!;
        expect(limited.scope).toBe('key');
        expect(limited.id).toBe(ids[3]!);
        expect(limited.retryAfterMs).toBeGreaterThan(0);
        expect(limited.retryAfterMs).toBeLessThanOrEqual(20_000);
        expect(framesOf(machine.state, 'relayed')).toHaveLength(3);
    });

    test('frames per address are limited before they are parsed', async () => {
        const broker = start({ framesPerSecondPerIp: 3 });
        const client = connect(broker, 'client', newKey());
        await waitUntil('the client to be ready', () => client.state.ready);
        // Hello and prove spent two of three, so the second of these is over the limit.
        client.socket.send('{"type":"relay"}');
        client.socket.send('{"type":"relay"}');
        await waitUntil('the limit', () => framesOf(client.state, 'rate-limited').length === 1);
        expect(framesOf(client.state, 'rate-limited')[0]!.scope).toBe('ip');
    });

    test('connections and sockets per address are limited at the upgrade', async () => {
        const perMinute = start({ connectionsPerMinutePerIp: 2 });
        const opened = [connect(perMinute, 'client', newKey()), connect(perMinute, 'client', newKey())];
        await waitUntil('two peers ready', () => opened.every((peer) => peer.state.ready));
        const third = connect(perMinute, 'client', newKey());
        await waitUntil('the third to be turned away', () => third.state.closed !== null);
        expect(third.state.ready).toBe(false);
        const refused = await fetch(`http://127.0.0.1:${perMinute.port}/`, { headers: { upgrade: 'websocket', connection: 'upgrade' } });
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);

        const perAddress = start({ maxSocketsPerIp: 1 });
        const only = connect(perAddress, 'client', newKey());
        await waitUntil('one peer ready', () => only.state.ready);
        const extra = connect(perAddress, 'client', newKey());
        await waitUntil('the extra socket to be turned away', () => extra.state.closed !== null);
        expect(extra.state.ready).toBe(false);
    });

    test('a key that announces too often is told to wait and closed', async () => {
        const broker = start({ announcesPerMinutePerKey: 1 });
        const key = newKey();
        const first = connect(broker, 'machine', key);
        await waitUntil('the first to be ready', () => first.state.ready);
        const second = connect(broker, 'machine', key);
        await waitUntil('the second to be closed', () => second.state.closed !== null);
        expect(second.state.closed).toBe(CLOSE.rateLimited);
        expect(framesOf(second.state, 'rate-limited')[0]!.scope).toBe('key');
        // The first stays: a flood of announcements is exactly what must not knock a machine off.
        expect(first.state.closed).toBeNull();
    });

    test('a frame over the size cap closes the socket', async () => {
        const broker = start({ maxMessageBytes: 2048 });
        const client = connect(broker, 'client', newKey());
        await waitUntil('the client to be ready', () => client.state.ready);
        client.socket.send('x'.repeat(4096));
        await waitUntil('the socket to close', () => client.state.closed !== null);
        // Bun drops a socket over `maxPayloadLength` without a close frame; a frame that slips past it gets 1009 from the broker.
        expect([CLOSE.tooLarge, 1006]).toContain(client.state.closed!);
        expect(framesOf(client.state, 'relayed')).toEqual([]);
    });

    test('a relay before the signature and a frame that is not one end the socket', async () => {
        const broker = start();
        const socket = new WebSocket(`ws://127.0.0.1:${broker.port}`);
        sockets.push(socket);
        const frames: BrokerServerFrame[] = [];
        let closed: number | null = null;
        socket.onmessage = (message) => frames.push(BrokerServerFrameSchema.parse(JSON.parse(String(message.data))));
        socket.onclose = (event) => {
            closed = event.code;
        };
        await new Promise((resolve) => {
            socket.onopen = resolve;
        });
        socket.send(JSON.stringify({ type: 'relay', id: 'r1', to: newKey().publicKey, envelope: offer, signature: 's'.repeat(86) }));
        await waitUntil('the socket to close', () => closed !== null);
        expect(closed === CLOSE.badFrame).toBe(true);
        expect(frames.map((frame) => frame.type)).toEqual(['error']);
    });

    test('the health route counts sockets and announced keys, and says nothing else', async () => {
        const broker = start();
        const machine = connect(broker, 'machine', newKey());
        await waitUntil('the machine to be ready', () => machine.state.ready);
        const health = await fetch(`http://127.0.0.1:${broker.port}/health`);
        expect(await health.json()).toEqual({ status: 'ok', sockets: 1, machines: 1, clients: 0 });
        expect((await fetch(`http://127.0.0.1:${broker.port}/anything`)).status).toBe(404);
    });
});

class FakeSocket implements PeerSocket {
    readonly sent: BrokerServerFrame[] = [];
    pings = 0;
    closed: number | null = null;

    send(frame: string): void {
        this.sent.push(JSON.parse(frame) as BrokerServerFrame);
    }

    close(code: number): void {
        this.closed = code;
    }

    ping(): void {
        this.pings += 1;
    }
}

describe('the broker without sockets', () => {
    const announce = (broker: Broker, socket: FakeSocket, key: TestKey) => {
        const peer = broker.open(socket, '192.0.2.1', 'broker.example.com');
        broker.message(peer, JSON.stringify({ type: 'hello', role: 'machine', publicKey: key.publicKey }));
        const challenge = socket.sent.at(-1) as Extract<BrokerServerFrame, { type: 'challenge' }>;
        expect(challenge.broker).toBe('broker.example.com');
        broker.message(
            peer,
            JSON.stringify({ type: 'prove', signature: signWith(key, brokerHelloMessage('broker.example.com', 'machine', key.publicKey, challenge.nonce)) })
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
        broker.open(socket, '192.0.2.1', 'broker.example.com');
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
