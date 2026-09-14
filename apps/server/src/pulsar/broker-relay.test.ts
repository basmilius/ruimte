import { describe, expect, test } from 'bun:test';
import { BrokerPeerFrameSchema, brokerHelloMessage, signalMessage, type BrokerPeerFrame, type SignalEnvelope } from '@ruimte/pulsar';
import { generateKeyPair, signMessage, verifySignature } from '../auth/keys.ts';
import { BrokerRelay } from './broker-relay.ts';

const BROKER_URL = 'ws://broker.test:4400';
const NONCE = 'n'.repeat(32);

/* The broker end of the daemon's socket, driven by hand. */
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

    addEventListener(): void {}

    deliver(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) });
    }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const waitUntil = async (ready: () => boolean): Promise<void> => {
    const deadline = Date.now() + 2_000;
    while (!ready()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};

const quiet = { log: () => undefined, warn: () => undefined };

const setup = async () => {
    const machine = generateKeyPair();
    const paired = generateKeyPair();
    const sockets: FakeSocket[] = [];
    const pairedKeys = new Set([paired.publicKey]);
    const received: SignalEnvelope[] = [];
    const replies: Array<(envelope: SignalEnvelope) => void> = [];
    const relay = new BrokerRelay({
        url: BROKER_URL,
        publicKey: machine.publicKey,
        sign: (message) => signMessage(machine.privateKey, message),
        isPaired: async (publicKey) => pairedKeys.has(publicKey),
        receive: (envelope, reply) => {
            received.push(envelope);
            replies.push(reply);
        },
        createSocket: () => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
        },
        backoffMinMs: 10,
        backoffMaxMs: 20,
        log: quiet
    });
    await relay.publish();
    const socket = sockets[0]!;
    socket.onopen?.();
    expect(socket.sent[0]).toEqual({ type: 'hello', role: 'machine', publicKey: machine.publicKey });
    socket.deliver({ type: 'challenge', broker: 'broker.test:4400', nonce: NONCE });
    await tick();
    const prove = socket.sent[1] as Extract<BrokerPeerFrame, { type: 'prove' }>;
    expect(verifySignature(machine.publicKey, brokerHelloMessage('broker.test:4400', 'machine', machine.publicKey, NONCE), prove.signature)).toBe(true);
    socket.deliver({ type: 'ready' });
    await relay.whenReady();
    return { relay, machine, paired, pairedKeys, sockets, socket, received, replies };
};

const offer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };

const relayedFrom = (from: { publicKey: string; privateKey: string }, to: string, envelope: SignalEnvelope, signer = from) => ({
    type: 'relayed',
    from: from.publicKey,
    envelope,
    signature: signMessage(signer.privateKey, signalMessage(from.publicKey, to, envelope))
});

describe('BrokerRelay', () => {
    test('announces with the machine key, hands a paired signal to the answer code and signs the reply back', async () => {
        const { relay, machine, paired, socket, received, replies } = await setup();
        socket.deliver(relayedFrom(paired, machine.publicKey, offer));
        await waitUntil(() => received.length === 1);
        expect(received[0]).toEqual(offer);

        const answer: SignalEnvelope = { connectionId: offer.connectionId, signal: { kind: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 BB' } };
        replies[0]!(answer);
        await waitUntil(() => socket.sent.length === 3);
        const frame = socket.sent[2] as Extract<BrokerPeerFrame, { type: 'relay' }>;
        expect(frame.to).toBe(paired.publicKey);
        expect(frame.envelope).toEqual(answer);
        expect(verifySignature(machine.publicKey, signalMessage(machine.publicKey, paired.publicKey, answer), frame.signature)).toBe(true);
        await relay.stop();
    });

    test('a signature that does not verify gets nothing at all, not even a refusal', async () => {
        const { relay, machine, paired, socket, received } = await setup();
        socket.deliver(relayedFrom(paired, machine.publicKey, offer, generateKeyPair()));
        // Signed for another receiver: the same bytes do not verify for this machine.
        socket.deliver(relayedFrom(paired, generateKeyPair().publicKey, offer));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(received).toEqual([]);
        expect(socket.sent).toHaveLength(2);
        await relay.stop();
    });

    test('a key nobody paired gets one signed not-paired for its offer, and no peer connection', async () => {
        const { relay, machine, socket, received } = await setup();
        const stranger = generateKeyPair();
        socket.deliver(relayedFrom(stranger, machine.publicKey, offer));
        await waitUntil(() => socket.sent.length === 3);
        const frame = socket.sent[2] as Extract<BrokerPeerFrame, { type: 'relay' }>;
        expect(frame.to).toBe(stranger.publicKey);
        expect(frame.envelope).toEqual({ connectionId: offer.connectionId, signal: { kind: 'close', reason: 'not-paired' } });
        expect(verifySignature(machine.publicKey, signalMessage(machine.publicKey, stranger.publicKey, frame.envelope), frame.signature)).toBe(true);

        // Anything but an offer from that key is not worth an answer.
        socket.deliver(relayedFrom(stranger, machine.publicKey, { connectionId: offer.connectionId, signal: { kind: 'close', reason: 'done' } }));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(socket.sent).toHaveLength(3);
        expect(received).toEqual([]);
        await relay.stop();
    });

    test('an attempt belongs to the key that offered it', async () => {
        const { relay, machine, paired, pairedKeys, socket, received } = await setup();
        socket.deliver(relayedFrom(paired, machine.publicKey, offer));
        await waitUntil(() => received.length === 1);
        // Paired as well, but not the owner of this attempt.
        const other = generateKeyPair();
        pairedKeys.add(other.publicKey);
        socket.deliver(relayedFrom(other, machine.publicKey, { connectionId: offer.connectionId, signal: { kind: 'close', reason: 'done' } }));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(received).toHaveLength(1);
        await relay.stop();
    });

    test('a lost broker is dialed again with a backoff, and a challenge for another host is never signed', async () => {
        const { relay, sockets, socket, machine } = await setup();
        socket.onclose?.();
        await waitUntil(() => sockets.length === 2);
        const second = sockets[1]!;
        second.onopen?.();
        second.deliver({ type: 'challenge', broker: 'elsewhere.test', nonce: NONCE });
        await tick();
        expect(second.sent).toEqual([{ type: 'hello', role: 'machine', publicKey: machine.publicKey }]);
        expect(second.closed).toBe(true);
        await waitUntil(() => sockets.length === 3);
        await relay.stop();
        expect(sockets[2]!.closed).toBe(true);
    });
});
