import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { BrokerPeerFrameSchema, brokerHelloMessage, signalMessage, type BrokerPeerFrame, type SignalAccess, type SignalEnvelope } from '@ruimte/pulsar';
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

// Fake timers leave setImmediate alone, so this drains every pending promise without letting a timer run.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/* Steps the fake clock a millisecond at a time; the bound is fake time, well past the longest backoff with its jitter. */
const waitUntil = async (ready: () => boolean): Promise<void> => {
    await tick();
    for (let elapsed = 0; !ready(); elapsed++) {
        if (elapsed > 100) {
            throw new Error('Not ready within 100 ms of fake time');
        }
        jest.advanceTimersByTime(1);
        await tick();
    }
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

const quiet = { log: () => undefined, warn: () => undefined };

const setup = async (admitStatement?: (publicKey: string, access: SignalAccess) => Promise<'admitted' | 'refused' | 'statements-refused'>) => {
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
        ...(admitStatement ? { admitStatement } : {}),
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
        await tick();
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
        await tick();
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
        await tick();
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
    test('an offer with a statement the gate takes pairs the key before it is answered, and one it refuses gets the reason', async () => {
        const access: SignalAccess = {
            statement: { machineId: 'm', clientPublicKey: 'A'.repeat(43), nonce: 'n'.repeat(22), issuedAt: 0, expiresAt: 1, signature: 's'.repeat(86) },
            label: 'Laptop'
        };
        const verdicts = new Map<string, 'admitted' | 'refused' | 'statements-refused'>();
        const asked: string[] = [];
        const { relay, machine, pairedKeys, socket, received } = await setup(async (publicKey, carried) => {
            asked.push(`${publicKey}:${carried.label}`);
            const verdict = verdicts.get(publicKey) ?? 'refused';
            if (verdict === 'admitted') {
                pairedKeys.add(publicKey);
            }
            return verdict;
        });
        const newcomer = generateKeyPair();
        verdicts.set(newcomer.publicKey, 'admitted');
        const carrying: SignalEnvelope = { connectionId: 'attempt-0002', signal: { kind: 'offer', sdp: 'v=0', access } };
        socket.deliver(relayedFrom(newcomer, machine.publicKey, carrying));
        await waitUntil(() => received.length === 1);
        expect(asked).toEqual([`${newcomer.publicKey}:Laptop`]);

        const refusedByFlag = generateKeyPair();
        verdicts.set(refusedByFlag.publicKey, 'statements-refused');
        socket.deliver(relayedFrom(refusedByFlag, machine.publicKey, { ...carrying, connectionId: 'attempt-0003' }));
        const refusedOutright = generateKeyPair();
        socket.deliver(relayedFrom(refusedOutright, machine.publicKey, { ...carrying, connectionId: 'attempt-0004' }));
        await waitUntil(() => socket.sent.length === 4);
        const reasons = socket.sent.slice(2).map((frame) => {
            const relayFrame = frame as Extract<BrokerPeerFrame, { type: 'relay' }>;
            return [relayFrame.to, relayFrame.envelope.signal.kind === 'close' ? relayFrame.envelope.signal.reason : null];
        });
        expect(reasons).toContainEqual([refusedByFlag.publicKey, 'statements-refused']);
        expect(reasons).toContainEqual([refusedOutright.publicKey, 'not-paired']);
        expect(received).toHaveLength(1);

        // A key that is paired already is never asked about the statement it carries.
        const before = asked.length;
        socket.deliver(relayedFrom(newcomer, machine.publicKey, { ...carrying, connectionId: 'attempt-0005' }));
        await waitUntil(() => received.length === 2);
        expect(asked).toHaveLength(before);
        await relay.stop();
    });
});
