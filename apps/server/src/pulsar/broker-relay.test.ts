import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { BrokerPeerFrameSchema, brokerHelloMessage, signalMessage, type BrokerPeerFrame, type SignalAccess, type SignalEnvelope } from '@ruimte/pulsar';
import { generateKeyPair, signMessage, verifySignature } from '../auth/keys.ts';
import { BrokerRelay, weriftIceServers } from './broker-relay.ts';

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

let clock = 0;

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
        log: quiet,
        now: () => clock
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
    // Every announcement asks for ICE servers straight away.
    expect(socket.sent[2]).toEqual({ type: 'ice', id: expect.stringMatching(/^ice-/) });
    socket.sent.splice(2, 1);
    return { relay, machine, paired, pairedKeys, sockets, socket, received, replies };
};

const offer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };

const relayedFrom = (from: { publicKey: string; privateKey: string }, to: string, envelope: SignalEnvelope, signer = from) => ({
    type: 'relayed',
    from: from.publicKey,
    envelope,
    signature: signMessage(signer.privateKey, signalMessage(from.publicKey, to, envelope))
});

const TURN = { urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'], username: '1:m-x', credential: 'one' };

describe('BrokerRelay and ICE servers', () => {
    const lastIce = (socket: FakeSocket) => socket.sent.filter((frame) => frame.type === 'ice').at(-1) as Extract<BrokerPeerFrame, { type: 'ice' }> | undefined;

    const withIceRequest = async () => {
        clock = 1_000_000;
        const machine = generateKeyPair();
        const sockets: FakeSocket[] = [];
        const relay = new BrokerRelay({
            url: BROKER_URL,
            publicKey: machine.publicKey,
            sign: (message) => signMessage(machine.privateKey, message),
            isPaired: async () => true,
            receive: () => undefined,
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket as unknown as WebSocket;
            },
            backoffMinMs: 10,
            backoffMaxMs: 20,
            log: quiet,
            now: () => clock
        });
        await relay.publish();
        const socket = sockets[0]!;
        socket.onopen?.();
        socket.deliver({ type: 'challenge', broker: 'broker.test:4400', nonce: NONCE });
        await tick();
        socket.deliver({ type: 'ready' });
        await relay.whenReady();
        return { relay, socket, sockets };
    };

    test('asks after ready, keeps the servers, and asks again with a third of their lifetime left', async () => {
        const { relay, socket } = await withIceRequest();
        const first = lastIce(socket)!;
        expect(relay.iceServers()).toEqual([]);
        socket.deliver({ type: 'ice', id: first.id, servers: [{ urls: 'stun:turn.example.com:3478' }, TURN], expiresAt: clock + 90_000 });
        expect(relay.iceServers()).toEqual([
            { urls: 'stun:turn.example.com:3478' },
            { urls: 'turn:turn.example.com:3478?transport=udp', username: '1:m-x', credential: 'one' }
        ]);

        jest.advanceTimersByTime(59_999);
        expect(socket.sent.filter((frame) => frame.type === 'ice')).toHaveLength(1);
        jest.advanceTimersByTime(1);
        const second = lastIce(socket)!;
        expect(second.id).not.toBe(first.id);

        // An answer to a question nobody asked any more changes nothing.
        socket.deliver({ type: 'ice', id: first.id, servers: [], expiresAt: null });
        expect(relay.iceServers()).toHaveLength(2);
        socket.deliver({ type: 'ice', id: second.id, servers: [{ ...TURN, credential: 'two' }], expiresAt: clock + 90_000 });
        expect(relay.iceServers()).toEqual([{ urls: 'turn:turn.example.com:3478?transport=udp', username: '1:m-x', credential: 'two' }]);

        // Past the expiry the credentials are worth nothing, and an attempt gets none rather than a refusal from the TURN server.
        clock += 90_000;
        expect(relay.iceServers()).toEqual([]);
        await relay.stop();
    });

    test('a refusal is asked again after the wait it names, and a lost broker keeps the credentials it gave', async () => {
        const { relay, socket, sockets } = await withIceRequest();
        socket.deliver({ type: 'rate-limited', scope: 'key', retryAfterMs: 5_000, id: lastIce(socket)!.id });
        expect(socket.closed).toBe(false);
        jest.advanceTimersByTime(5_000);
        const retried = lastIce(socket)!;
        socket.deliver({ type: 'error', code: 'internal', message: 'no secret', id: retried.id });
        jest.advanceTimersByTime(60_000);
        const again = lastIce(socket)!;
        expect(again.id).not.toBe(retried.id);
        socket.deliver({ type: 'ice', id: again.id, servers: [TURN], expiresAt: clock + 3_600_000 });

        socket.onclose?.();
        expect(relay.iceServers()).toHaveLength(1);
        await waitUntil(() => sockets.length === 2);
        await relay.stop();
    });

    test('a broker from before ice refuses the frame without its id, and the socket stays', async () => {
        const { relay, socket, sockets } = await withIceRequest();
        socket.deliver({ type: 'error', code: 'bad-frame', message: 'That is not a broker frame' });
        expect(socket.closed).toBe(false);
        expect(sockets).toHaveLength(1);
        expect(relay.iceServers()).toEqual([]);
        await relay.stop();
    });

    test('werift gets every STUN URL and one TURN URL, UDP first', () => {
        expect(
            weriftIceServers([
                { urls: 'stun:stun.example.com:3478' },
                {
                    urls: ['turns:turn.example.com:5349?transport=tcp', 'turn:turn.example.com:3478?transport=tcp', 'turn:turn.example.com:3478?transport=udp'],
                    username: 'u',
                    credential: 'c'
                }
            ])
        ).toEqual([{ urls: 'stun:stun.example.com:3478' }, { urls: 'turn:turn.example.com:3478?transport=udp', username: 'u', credential: 'c' }]);
        expect(weriftIceServers([{ urls: ['turns:turn.example.com:5349'], username: 'u', credential: 'c' }])).toEqual([
            { urls: 'turns:turn.example.com:5349', username: 'u', credential: 'c' }
        ]);
        expect(weriftIceServers([])).toEqual([]);
    });
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
