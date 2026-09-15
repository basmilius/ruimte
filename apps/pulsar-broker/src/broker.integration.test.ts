import { afterEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { BrokerPeer, BrokerServerFrameSchema, type BrokerRole, type BrokerServerFrame, type SignalEnvelope } from '@ruimte/pulsar';
import { DEFAULT_LIMITS, type BrokerLimits } from './config.ts';
import { startBroker, type RunningBroker } from './server.ts';

/*
 * Only what `startBroker` adds to `Broker`: the WebSocket handlers that feed it, the HTTP answers
 * around the upgrade and the health route. The rules themselves are tested without sockets in
 * `broker.test.ts`.
 */

interface TestKey {
    publicKey: string;
    privateKey: KeyObject;
}

const newKey = (): TestKey => {
    const pair = generateKeyPairSync('ed25519');
    return { publicKey: (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x, privateKey: pair.privateKey };
};

const signWith = (key: TestKey, message: string): string => sign(null, Buffer.from(message), key.privateKey).toString('base64url');

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
    const broker = startBroker({ host: '127.0.0.1', port: 0, names: [], trustProxy: false, trustCloudflare: false, limits: { ...DEFAULT_LIMITS, ...limits } });
    running.push(broker);
    return broker;
};

const connect = (broker: RunningBroker, role: BrokerRole, key: TestKey) => {
    const socket = new WebSocket(`ws://127.0.0.1:${broker.port}`);
    sockets.push(socket);
    const state = { frames: [] as BrokerServerFrame[], ready: false };
    const peer = new BrokerPeer({
        role,
        publicKey: key.publicKey,
        host: `127.0.0.1:${broker.port}`,
        sign: (message) => signWith(key, message),
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
    return { peer, state, key };
};

const offer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };
const answer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 BB' } };

const relayedTo = (state: { frames: BrokerServerFrame[] }) => state.frames.filter((frame) => frame.type === 'relayed');

describe('the broker over real sockets', () => {
    test('a machine and a client announce on the host they dialed, and a signal travels both ways', async () => {
        const broker = start();
        const machine = connect(broker, 'machine', newKey());
        const client = connect(broker, 'client', newKey());
        await waitUntil('both peers to be ready', () => machine.state.ready && client.state.ready);
        expect(broker.broker.counts).toEqual({ sockets: 2, machines: 1, clients: 1 });

        await client.peer.relay(machine.key.publicKey, offer);
        await waitUntil('the offer to arrive', () => relayedTo(machine.state).length === 1);
        expect(relayedTo(machine.state)[0]).toMatchObject({ from: client.key.publicKey, envelope: offer });

        await machine.peer.relay(client.key.publicKey, answer);
        await waitUntil('the answer to arrive', () => relayedTo(client.state).length === 1);
        expect(relayedTo(client.state)[0]).toMatchObject({ from: machine.key.publicKey, envelope: answer });
    });

    test('an address over its limit is refused at the upgrade with a Retry-After', async () => {
        const broker = start({ connectionsPerMinutePerIp: 1 });
        const first = connect(broker, 'client', newKey());
        await waitUntil('the first peer to be ready', () => first.state.ready);
        const refused = await fetch(`http://127.0.0.1:${broker.port}/`, { headers: { upgrade: 'websocket', connection: 'upgrade' } });
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    test('the health route counts sockets and announced keys, and anything else that is no upgrade is not found', async () => {
        const broker = start();
        const machine = connect(broker, 'machine', newKey());
        await waitUntil('the machine to be ready', () => machine.state.ready);
        const health = await fetch(`http://127.0.0.1:${broker.port}/health`);
        expect(await health.json()).toEqual({ status: 'ok', sockets: 1, machines: 1, clients: 0 });
        expect((await fetch(`http://127.0.0.1:${broker.port}/anything`)).status).toBe(404);
    });
});
