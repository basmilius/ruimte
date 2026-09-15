import { describe, expect, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { BrokerPeerFrameSchema, brokerHelloMessage, signalMessage, type BrokerPeerFrame, type SignalAccess, type SignalEnvelope } from '@ruimte/pulsar';
import type { ClientKey } from '@/endpoint/client-key';
import { BrokerSockets, brokerSignaling } from './broker-signaling';
import type { Signal, SignalingEvents } from './signaling';

const BROKER_URL = 'wss://broker.example.com';
const NONCE = 'n'.repeat(32);

const newKey = () => {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x;
    return { publicKey, sign: (message: string) => sign(null, Buffer.from(message), pair.privateKey).toString('base64url') };
};

const verifies = async (publicKey: string, message: string, signature: string): Promise<boolean> =>
    verify(
        null,
        Buffer.from(message),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    );

class FakeSocket {
    readonly sent: BrokerPeerFrame[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    send(frame: string): void {
        this.sent.push(BrokerPeerFrameSchema.parse(JSON.parse(frame)));
    }

    close(): void {
        this.closed = true;
    }

    deliver(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) });
    }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (access?: (key: ClientKey) => Promise<SignalAccess>) => {
    const client = newKey();
    const machine = newKey();
    const sockets: FakeSocket[] = [];
    const brokers = new BrokerSockets(() => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
    });
    const key: ClientKey = { publicKey: client.publicKey, sign: async (message) => client.sign(message) };
    const open = brokerSignaling({
        brokerUrl: BROKER_URL,
        machineKey: machine.publicKey,
        key: async () => key,
        verify: verifies,
        sockets: brokers,
        ...(access ? { access } : {})
    });
    const attempt = (connectionId: string) => {
        const log = { ready: 0, iceServers: [] as unknown[], signals: [] as Signal[], failures: [] as string[] };
        const events: SignalingEvents = {
            ready: (iceServers) => {
                log.ready += 1;
                log.iceServers.push(iceServers);
            },
            signal: (signal) => log.signals.push(signal),
            fail: (reason) => log.failures.push(reason)
        };
        return { signaling: open(connectionId, events), log };
    };
    /* Opens the broker socket and walks it through the announcement and the question for ICE servers, answered with `servers`. */
    const announce = async (servers: unknown[] = []): Promise<FakeSocket> => {
        await settle();
        const socket = sockets.at(-1)!;
        socket.onopen?.();
        socket.deliver({ type: 'challenge', broker: 'broker.example.com', nonce: NONCE });
        await settle();
        socket.deliver({ type: 'ready' });
        await settle();
        const ice = socket.sent.at(-1) as Extract<BrokerPeerFrame, { type: 'ice' }>;
        expect(ice.type).toBe('ice');
        socket.deliver({ type: 'ice', id: ice.id, servers, expiresAt: servers.length > 0 ? Date.now() + 3_600_000 : null });
        await settle();
        return socket;
    };
    const answerFrom = (signer: { publicKey: string; sign(message: string): string }, envelope: SignalEnvelope) => ({
        type: 'relayed',
        from: machine.publicKey,
        envelope,
        signature: signer.sign(signalMessage(machine.publicKey, client.publicKey, envelope))
    });
    return { client, machine, sockets, attempt, announce, answerFrom };
};

describe('brokerSignaling', () => {
    test('announces the client key, signs the offer for the machine, and passes on an answer the machine signed', async () => {
        const { client, machine, attempt, announce, answerFrom } = setup();
        const { signaling, log } = attempt('attempt-0001');
        const socket = await announce();
        expect(socket.sent[0]).toEqual({ type: 'hello', role: 'client', publicKey: client.publicKey });
        const prove = socket.sent[1] as Extract<BrokerPeerFrame, { type: 'prove' }>;
        expect(await verifies(client.publicKey, brokerHelloMessage('broker.example.com', 'client', client.publicKey, NONCE), prove.signature)).toBe(true);
        expect(log.ready).toBe(1);

        signaling.send({ kind: 'offer', sdp: 'v=0' });
        await settle();
        const relay = socket.sent[3] as Extract<BrokerPeerFrame, { type: 'relay' }>;
        expect(relay.to).toBe(machine.publicKey);
        expect(relay.envelope).toEqual({ connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0' } });
        expect(await verifies(client.publicKey, signalMessage(client.publicKey, machine.publicKey, relay.envelope), relay.signature)).toBe(true);

        // Another attempt's answer is none of this one's business.
        socket.deliver(answerFrom(machine, { connectionId: 'attempt-other', signal: { kind: 'answer', sdp: 'v=1' } }));
        socket.deliver(answerFrom(machine, { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=0 answer' } }));
        await settle();
        expect(log.signals).toEqual([{ kind: 'answer', sdp: 'v=0 answer' }]);
        expect(log.failures).toEqual([]);

        signaling.close();
        expect(socket.closed).toBe(true);
    });

    test('an answer the machine did not sign ends the attempt instead of reaching the peer connection', async () => {
        const { attempt, announce, answerFrom } = setup();
        const { log } = attempt('attempt-0001');
        const socket = await announce();
        socket.deliver(answerFrom(newKey(), { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=0' } }));
        await settle();
        expect(log.signals).toEqual([]);
        expect(log.failures).toEqual(['A signal on the broker names the machine but is not signed by it']);
        expect(socket.closed).toBe(true);
    });

    test('a machine that is not on the broker is said in so many words', async () => {
        const { attempt, announce } = setup();
        const { signaling, log } = attempt('attempt-0001');
        const socket = await announce();
        signaling.send({ kind: 'offer', sdp: 'v=0' });
        await settle();
        const relay = socket.sent[3] as Extract<BrokerPeerFrame, { type: 'relay' }>;
        socket.deliver({ type: 'error', code: 'not-connected', message: 'Nobody with that key is connected', id: relay.id });
        await settle();
        expect(log.failures).toEqual(['The machine is not connected to the broker at broker.example.com. It needs to run with the broker switched on.']);
    });

    test('asks the broker for ICE servers before signals go out, and hands them to every attempt on the socket', async () => {
        const { sockets, attempt, announce } = setup();
        const turn = { urls: ['turn:turn.example.com:3478?transport=udp'], username: '1:c-x', credential: 'y' };
        const first = attempt('attempt-0001');
        const socket = await announce([turn]);
        expect(first.log.iceServers).toEqual([[turn]]);

        // A later attempt on the same socket gets the servers without asking again.
        const second = attempt('attempt-0002');
        await settle();
        expect(second.log.iceServers).toEqual([[turn]]);
        expect(sockets).toHaveLength(1);
        expect(socket.sent.filter((frame) => frame.type === 'ice')).toHaveLength(1);
    });

    test('a broker that cannot hand out servers, or does not know the question, still lets the attempt signal', async () => {
        const failing = setup();
        const one = failing.attempt('attempt-0001');
        await settle();
        const socket = failing.sockets.at(-1)!;
        socket.onopen?.();
        socket.deliver({ type: 'challenge', broker: 'broker.example.com', nonce: NONCE });
        await settle();
        socket.deliver({ type: 'ready' });
        await settle();
        expect(one.log.ready).toBe(0);
        const ice = socket.sent.at(-1) as Extract<BrokerPeerFrame, { type: 'ice' }>;
        socket.deliver({ type: 'error', code: 'internal', message: 'The broker could not hand out ICE servers', id: ice.id });
        await settle();
        expect(one.log.iceServers).toEqual([[]]);
        expect(one.log.failures).toEqual([]);

        const old = setup();
        const two = old.attempt('attempt-0001');
        await settle();
        const oldSocket = old.sockets.at(-1)!;
        oldSocket.onopen?.();
        oldSocket.deliver({ type: 'challenge', broker: 'broker.example.com', nonce: NONCE });
        await settle();
        oldSocket.deliver({ type: 'ready' });
        await settle();
        oldSocket.deliver({ type: 'error', code: 'bad-frame', message: 'That is not a broker frame' });
        await settle();
        expect(two.log.iceServers).toEqual([[]]);
        expect(two.log.failures).toEqual([]);
        expect(oldSocket.closed).toBe(false);
    });

    test('two attempts share one broker socket, which closes when the last one leaves', async () => {
        const { sockets, attempt, announce } = setup();
        const first = attempt('attempt-0001');
        const second = attempt('attempt-0002');
        const socket = await announce();
        expect(sockets).toHaveLength(1);
        expect(first.log.ready + second.log.ready).toBe(2);
        first.signaling.close();
        expect(socket.closed).toBe(false);
        second.signaling.close();
        expect(socket.closed).toBe(true);
    });

    test('a broker socket that drops fails every attempt on it, and a replaced one says the broker refused', async () => {
        const { attempt, announce } = setup();
        const first = attempt('attempt-0001');
        const socket = await announce();
        socket.onclose?.();
        expect(first.log.failures).toEqual(['The broker at broker.example.com could not be reached']);

        const second = attempt('attempt-0002');
        const next = await announce();
        next.deliver({ type: 'error', code: 'replaced', message: 'The same key announced on another socket' });
        await settle();
        expect(second.log.failures).toEqual(['The broker at broker.example.com refused this client: The same key announced on another socket']);
    });
    test('an offer to a machine that needs a statement carries one asked for with this client key, signed along with the offer', async () => {
        const asked: string[] = [];
        const statement = { machineId: 'm', clientPublicKey: 'A'.repeat(43), nonce: 'n'.repeat(22), issuedAt: 0, expiresAt: 1, signature: 's'.repeat(86) };
        const { client, machine, attempt, announce } = setup(async (key) => {
            asked.push(key.publicKey);
            return { statement, label: 'Laptop' };
        });
        const { signaling } = attempt('attempt-0001');
        const socket = await announce();
        signaling.send({ kind: 'offer', sdp: 'v=0' });
        signaling.send({ kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null });
        await settle();
        const relays = socket.sent.filter((frame) => frame.type === 'relay') as Extract<BrokerPeerFrame, { type: 'relay' }>[];
        const offer = relays.find((relay) => relay.envelope.signal.kind === 'offer')!;
        expect(offer.envelope.signal).toEqual({ kind: 'offer', sdp: 'v=0', access: { statement, label: 'Laptop' } });
        expect(await verifies(client.publicKey, signalMessage(client.publicKey, machine.publicKey, offer.envelope), offer.signature)).toBe(true);
        expect(relays.find((relay) => relay.envelope.signal.kind === 'candidate')?.envelope.signal).not.toHaveProperty('access');
        expect(asked).toEqual([client.publicKey]);
    });

    test('an account that cannot vouch ends the attempt with why, and sends no offer', async () => {
        const { attempt, announce } = setup(async () => {
            throw new Error('Sign in to your account first');
        });
        const { signaling, log } = attempt('attempt-0001');
        const socket = await announce();
        signaling.send({ kind: 'offer', sdp: 'v=0' });
        await settle();
        expect(log.failures).toEqual(['Your account could not vouch for this client: Sign in to your account first']);
        expect(socket.sent.filter((frame) => frame.type === 'relay')).toEqual([]);
    });
});
