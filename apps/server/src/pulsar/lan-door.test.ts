import { describe, expect, test } from 'bun:test';
import { lanDoorMessage, signalMessage, type LanDoorMachineFrame, type SignalEnvelope } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { ATTEMPTS_PER_MINUTE, AddressLimiter, DoorSession, OPEN_PER_ADDRESS } from './lan-door.ts';
import { SignalGate } from './signal-gate.ts';

const machine = generateKeyPair();
const MACHINE_ID = 'machine-1';
const NONCE = 'n'.repeat(32);

class FakeSocket {
    readonly sent: LanDoorMachineFrame[] = [];
    closedWith: [number, string] | null = null;

    get open(): boolean {
        return this.closedWith === null;
    }

    send(frame: LanDoorMachineFrame): void {
        this.sent.push(frame);
    }

    close(code: number, reason: string): void {
        this.closedWith = [code, reason];
    }
}

const setup = (known: string[] = []) => {
    const received: SignalEnvelope[] = [];
    const replies: Array<(envelope: SignalEnvelope) => void> = [];
    const gate = new SignalGate({
        publicKey: machine.publicKey,
        isPaired: async (publicKey) => known.includes(publicKey),
        receive: (envelope, reply) => {
            received.push(envelope);
            replies.push(reply);
        },
        log: { warn: () => undefined }
    });
    const socket = new FakeSocket();
    const session = new DoorSession(
        { machineId: MACHINE_ID, publicKey: machine.publicKey, sign: (message) => signMessage(machine.privateKey, message) },
        gate,
        socket
    );
    return { session, socket, received, replies };
};

const offer: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };

const signalFrom = (key: { publicKey: string; privateKey: string }, envelope: SignalEnvelope, signer = key) =>
    JSON.stringify({
        type: 'signal',
        from: key.publicKey,
        envelope,
        signature: signMessage(signer.privateKey, signalMessage(key.publicKey, machine.publicKey, envelope))
    });

describe('DoorSession', () => {
    test('the machine answers a hello with its signature over the client nonce, before the client says who it is', async () => {
        const { session, socket } = setup();
        await session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        const proof = socket.sent[0];
        expect(proof).toMatchObject({ type: 'door', machineId: MACHINE_ID, publicKey: machine.publicKey });
        expect(verifySignature(machine.publicKey, lanDoorMessage(NONCE, MACHINE_ID, machine.publicKey), (proof as { signature: string }).signature)).toBe(true);
        expect(session.hasGreeted).toBe(true);
    });

    test('a known key signals through the gate and gets its answer signed for it', async () => {
        const client = generateKeyPair();
        const { session, socket, received, replies } = setup([client.publicKey]);
        await session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        await session.receive(signalFrom(client, offer));
        expect(received).toEqual([offer]);

        const answer: SignalEnvelope = { connectionId: offer.connectionId, signal: { kind: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 BB' } };
        replies[0]!(answer);
        const frame = socket.sent[1] as Extract<LanDoorMachineFrame, { type: 'signal' }>;
        expect(frame.envelope).toEqual(answer);
        expect(verifySignature(machine.publicKey, signalMessage(machine.publicKey, client.publicKey, answer), frame.signature)).toBe(true);
    });

    test('a key the machine does not know, without a statement, hears not-paired and reaches nothing', async () => {
        const stranger = generateKeyPair();
        const { session, socket, received } = setup();
        await session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        await session.receive(signalFrom(stranger, offer));
        expect(received).toEqual([]);
        expect(socket.sent[1]).toMatchObject({
            type: 'signal',
            envelope: { connectionId: offer.connectionId, signal: { kind: 'close', reason: 'not-paired' } }
        });
    });

    test('a signal before hello, a second hello, a second key or a forged signature closes the socket', async () => {
        const client = generateKeyPair();
        const early = setup([client.publicKey]);
        await early.session.receive(signalFrom(client, offer));
        expect(early.socket.sent).toEqual([{ type: 'error', code: 'bad-frame', message: 'Say hello first' }]);
        expect(early.socket.closedWith?.[0]).toBe(4003);
        expect(early.received).toEqual([]);

        const twice = setup();
        await twice.session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        await twice.session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        expect(twice.socket.closedWith).not.toBeNull();

        const other = generateKeyPair();
        const switching = setup([client.publicKey, other.publicKey]);
        await switching.session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        await switching.session.receive(signalFrom(client, offer));
        await switching.session.receive(signalFrom(other, { ...offer, connectionId: 'attempt-0002' }));
        expect(switching.received).toHaveLength(1);
        expect(switching.socket.closedWith).not.toBeNull();

        const forged = setup([client.publicKey]);
        await forged.session.receive(JSON.stringify({ type: 'hello', nonce: NONCE }));
        await forged.session.receive(signalFrom(client, offer, generateKeyPair()));
        expect(forged.received).toEqual([]);
        expect(forged.socket.sent[1]).toEqual({ type: 'error', code: 'bad-frame', message: 'That signature does not hold' });
    });

    test('what does not parse is refused without an answer signed for it', async () => {
        const { session, socket } = setup();
        await session.receive('not json');
        expect(socket.sent).toEqual([{ type: 'error', code: 'bad-frame', message: 'Expected JSON' }]);
        const other = setup();
        await other.session.receive(JSON.stringify({ type: 'hello', nonce: 'short' }));
        expect(other.socket.sent).toEqual([{ type: 'error', code: 'bad-frame', message: 'Expected a hello or a signal' }]);
    });
});

describe('AddressLimiter', () => {
    test('an address opens a limited number of sockets per minute, and holds a limited number at once', () => {
        let now = 0;
        const limiter = new AddressLimiter(() => now);
        for (let i = 0; i < OPEN_PER_ADDRESS; i++) {
            expect(limiter.admit('192.168.1.30')).toBe(true);
        }
        expect(limiter.admit('192.168.1.30')).toBe(false);
        // Another address is counted on its own.
        expect(limiter.admit('192.168.1.31')).toBe(true);
        limiter.release('192.168.1.30');
        expect(limiter.admit('192.168.1.30')).toBe(true);

        for (let i = 0; i < OPEN_PER_ADDRESS + 1; i++) {
            limiter.release('192.168.1.30');
        }
        let opened = OPEN_PER_ADDRESS + 1;
        while (opened < ATTEMPTS_PER_MINUTE) {
            expect(limiter.admit('192.168.1.30')).toBe(true);
            limiter.release('192.168.1.30');
            opened += 1;
        }
        expect(limiter.admit('192.168.1.30')).toBe(false);
        now += 60_000;
        expect(limiter.admit('192.168.1.30')).toBe(true);
    });
});
