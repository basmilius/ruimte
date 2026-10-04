import { describe, expect, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { LanDoorClientFrameSchema, lanDoorMessage, signalMessage, type LanDoorClientFrame, type SignalAccess, type SignalEnvelope } from '@ruimte/pulsar';
import i18next from 'i18next';
import type { ClientKey } from '@/endpoint/client-key';
import { lanSignaling } from './lan-signaling';
import type { Signal, SignalingEvents } from './signaling';

const NONCE = 'n'.repeat(32);
const MACHINE_ID = 'studio';

function newKey() {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x;
    return { publicKey, sign: (message: string) => sign(null, Buffer.from(message), pair.privateKey).toString('base64url') };
}

async function verifies(publicKey: string, message: string, signature: string): Promise<boolean> {
    return verify(
        null,
        Buffer.from(message),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    );
}

class FakeSocket {
    readonly sent: LanDoorClientFrame[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    send(frame: string): void {
        this.sent.push(LanDoorClientFrameSchema.parse(JSON.parse(frame)));
    }

    close(): void {
        this.closed = true;
    }

    deliver(frame: unknown): void {
        this.onmessage?.({ data: JSON.stringify(frame) });
    }
}

function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(options: { machineId?: string | null; access?: (key: ClientKey) => Promise<SignalAccess> } = {}) {
    const client = newKey();
    const machine = newKey();
    const sockets: FakeSocket[] = [];
    const key: ClientKey = { publicKey: client.publicKey, sign: async (message) => client.sign(message) };
    const log = { ready: [] as unknown[][], signals: [] as Signal[], failures: [] as string[] };
    const events: SignalingEvents = {
        ready: (...args) => log.ready.push(args),
        signal: (signal) => log.signals.push(signal),
        fail: (reason) => log.failures.push(reason)
    };
    const signaling = lanSignaling({
        url: 'ws://192.168.1.20:4220/signal',
        machineKey: machine.publicKey,
        machineId: options.machineId === undefined ? MACHINE_ID : options.machineId,
        key: async () => key,
        verify: verifies,
        nonce: () => NONCE,
        createSocket: () => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
        },
        ...(options.access ? { access: options.access } : {})
    })('attempt-0001', events);
    const socket = sockets[0]!;
    socket.onopen?.();

    /* The door's answer to the hello, signed by `signer` for the key and id it names. */
    const proof = (signer = machine, publicKey = machine.publicKey, machineId = MACHINE_ID) => ({
        type: 'door',
        machineId,
        publicKey,
        signature: signer.sign(lanDoorMessage(NONCE, machineId, publicKey))
    });
    const signalFrom = (signer: { sign(message: string): string }, envelope: SignalEnvelope) => ({
        type: 'signal',
        envelope,
        signature: signer.sign(signalMessage(machine.publicKey, client.publicKey, envelope))
    });
    const sentClientKey = (): boolean => JSON.stringify(socket.sent).includes(client.publicKey);
    return { client, machine, socket, signaling, log, proof, signalFrom, sentClientKey };
}

describe('lanSignaling', () => {
    test('speaks first with a nonce alone, and is ready without ICE servers once the pinned key signed it', async () => {
        const { socket, log, proof, sentClientKey } = setup();
        expect(socket.sent).toEqual([{ type: 'hello', nonce: NONCE }]);
        expect(log.ready).toEqual([]);

        socket.deliver(proof());
        await settle();
        expect(log.ready).toEqual([[]]);
        expect(log.failures).toEqual([]);
        expect(sentClientKey()).toBe(false);
    });

    test('signs an offer for the machine the way the broker route does', async () => {
        const { client, machine, socket, signaling, proof } = setup();
        socket.deliver(proof());
        await settle();

        signaling.send({ kind: 'offer', sdp: 'v=0' });
        await settle();
        const frame = socket.sent[1] as Extract<LanDoorClientFrame, { type: 'signal' }>;
        expect(frame.from).toBe(client.publicKey);
        expect(frame.envelope).toEqual({ connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0' } });
        expect(await verifies(client.publicKey, signalMessage(client.publicKey, machine.publicKey, frame.envelope), frame.signature)).toBe(true);
    });

    test('a door with another key is refused, and the client key never leaves', async () => {
        const { socket, signaling, log, proof, sentClientKey } = setup();
        const stranger = newKey();
        socket.deliver(proof(stranger, stranger.publicKey));
        await settle();

        expect(log.failures).toEqual([i18next.t('machines:lan.notProven')]);
        expect(log.ready).toEqual([]);
        expect(socket.closed).toBe(true);
        signaling.send({ kind: 'offer', sdp: 'v=0' });
        await settle();
        expect(socket.sent).toEqual([{ type: 'hello', nonce: NONCE }]);
        expect(sentClientKey()).toBe(false);
    });

    test('the pinned key with a signature it did not make is refused the same way', async () => {
        const { socket, log, proof, sentClientKey } = setup();
        socket.deliver(proof(newKey()));
        await settle();
        expect(log.failures).toEqual([i18next.t('machines:lan.notProven')]);
        expect(sentClientKey()).toBe(false);
    });

    test('a door that names another machine is refused, and one is believed under any id while the row knows none', async () => {
        const named = setup();
        named.socket.deliver(named.proof(named.machine, named.machine.publicKey, 'attic'));
        await settle();
        expect(named.log.failures).toEqual([i18next.t('machines:lan.notProven')]);

        const unnamed = setup({ machineId: null });
        unnamed.socket.deliver(unnamed.proof(unnamed.machine, unnamed.machine.publicKey, 'attic'));
        await settle();
        expect(unnamed.log.ready).toHaveLength(1);
    });

    test('passes on a signal the machine signed, leaves another attempt alone, and ends on one it did not sign', async () => {
        const { machine, socket, log, proof, signalFrom } = setup();
        socket.deliver(signalFrom(machine, { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'early' } }));
        await settle();
        // Nothing is believed before the proof held.
        expect(log.signals).toEqual([]);

        socket.deliver(proof());
        await settle();
        socket.deliver(signalFrom(machine, { connectionId: 'attempt-other', signal: { kind: 'answer', sdp: 'v=2' } }));
        socket.deliver(signalFrom(machine, { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=1' } }));
        await settle();
        expect(log.signals).toEqual([{ kind: 'answer', sdp: 'v=1' }]);

        socket.deliver(signalFrom(newKey(), { connectionId: 'attempt-0001', signal: { kind: 'answer', sdp: 'v=3' } }));
        await settle();
        expect(log.failures).toEqual([i18next.t('machines:lan.unsignedSignal')]);
        expect(log.signals).toHaveLength(1);
    });

    test('a refusal reaches the link as the close signal it is', async () => {
        const { machine, socket, log, proof, signalFrom } = setup();
        socket.deliver(proof());
        await settle();
        socket.deliver(signalFrom(machine, { connectionId: 'attempt-0001', signal: { kind: 'close', reason: 'not-paired' } }));
        await settle();
        expect(log.signals).toEqual([{ kind: 'close', reason: 'not-paired' }]);
        expect(log.failures).toEqual([]);
    });

    test('an error from the door and a door that hangs up both end the attempt with a sentence', async () => {
        const errored = setup();
        errored.socket.deliver({ type: 'error', code: 'rate-limited', message: 'Too many attempts' });
        expect(errored.log.failures).toEqual([i18next.t('machines:lan.refused', { reason: 'Too many attempts' })]);

        const dropped = setup();
        dropped.socket.onclose?.();
        expect(dropped.log.failures).toEqual([i18next.t('machines:lan.unreachable')]);
    });

    test('an offer carries a statement asked for with this client key when the machine does not know it yet', async () => {
        const asked: string[] = [];
        const statement = { machineId: 'm', clientPublicKey: 'A'.repeat(43), nonce: 'n'.repeat(22), issuedAt: 0, expiresAt: 1, signature: 's'.repeat(86) };
        const { client, socket, signaling, proof } = setup({
            access: async (key) => {
                asked.push(key.publicKey);
                return { statement, label: 'Laptop' };
            }
        });
        socket.deliver(proof());
        await settle();
        signaling.send({ kind: 'offer', sdp: 'v=0' });
        signaling.send({ kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null });
        await settle();
        const signals = (socket.sent.slice(1) as Array<Extract<LanDoorClientFrame, { type: 'signal' }>>).map((frame) => frame.envelope.signal);
        expect(signals).toContainEqual({ kind: 'offer', sdp: 'v=0', access: { statement, label: 'Laptop' } });
        expect(signals).toContainEqual({ kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null });
        expect(asked).toEqual([client.publicKey]);
    });

    test('closing lets go of the socket and reports nothing after', async () => {
        const { socket, signaling, log, proof } = setup();
        signaling.close();
        expect(socket.closed).toBe(true);
        socket.deliver(proof());
        await settle();
        expect(log.ready).toEqual([]);
        expect(log.failures).toEqual([]);
    });
});
