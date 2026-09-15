import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import {
    SIGNING_PURPOSES,
    accessRequestMessage,
    accessStatementMessage,
    brokerHelloMessage,
    machineRegistrationMessage,
    sessionKeyMessage,
    sessionRefreshMessage,
    signalMessage,
    type SignalEnvelope
} from './index.ts';

const key = 'A'.repeat(43);
const otherKey = 'B'.repeat(43);
const nonce = 'n'.repeat(22);

// One call per purpose over the same values, so only the purpose can make two of them differ.
const everyPurpose = (): Record<keyof typeof SIGNING_PURPOSES, string> => ({
    brokerHello: brokerHelloMessage('machine-1', 'machine', key, nonce),
    signal: signalMessage(key, otherKey, { connectionId: 'machine-1', signal: { kind: 'close', reason: 'done' } }),
    machineRegistration: machineRegistrationMessage('machine-1', 'machine-1', key, 'machine', 0),
    accessRequest: accessRequestMessage('machine-1', key, nonce),
    accessStatement: accessStatementMessage('machine-1', key, nonce, 0, 120_000),
    sessionKey: sessionKeyMessage(nonce, key),
    sessionRefresh: sessionRefreshMessage(nonce, 0)
});

describe('signed bytes', () => {
    test('every purpose opens with its own prefix line', () => {
        const messages = everyPurpose();
        for (const [purpose, message] of Object.entries(messages)) {
            expect(message.split('\n')[0]).toBe(SIGNING_PURPOSES[purpose as keyof typeof SIGNING_PURPOSES]);
        }
        expect(new Set(Object.values(SIGNING_PURPOSES)).size).toBe(Object.keys(SIGNING_PURPOSES).length);
        expect(new Set(Object.values(messages)).size).toBe(Object.keys(messages).length);
    });

    test('no prefix is the daemon handshake one', () => {
        for (const prefix of Object.values(SIGNING_PURPOSES)) {
            expect(prefix.startsWith('ruimte-')).toBe(false);
            expect(prefix.includes('\n')).toBe(false);
        }
    });

    test('a signature for one purpose does not verify as another', () => {
        const pair = generateKeyPairSync('ed25519');
        const hello = brokerHelloMessage('broker.example.com', 'machine', key, nonce);
        const signature = sign(null, Buffer.from(hello), pair.privateKey);

        expect(verify(null, Buffer.from(hello), pair.publicKey, signature)).toBe(true);
        expect(verify(null, Buffer.from(brokerHelloMessage('broker.example.com', 'client', key, nonce)), pair.publicKey, signature)).toBe(false);
        expect(verify(null, Buffer.from(brokerHelloMessage('elsewhere.example.com', 'machine', key, nonce)), pair.publicKey, signature)).toBe(false);
        expect(verify(null, Buffer.from(accessRequestMessage('broker.example.com', key, nonce)), pair.publicKey, signature)).toBe(false);
    });

    test('a signal binds sender, receiver, attempt and every field of the signal', () => {
        const offer: SignalEnvelope = { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };
        const base = signalMessage(key, otherKey, offer);

        expect(signalMessage(otherKey, key, offer)).not.toBe(base);
        expect(signalMessage(key, otherKey, { ...offer, connectionId: 'attempt-2' })).not.toBe(base);
        expect(
            signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'answer', sdp: offer.signal.kind === 'offer' ? offer.signal.sdp : '' } })
        ).not.toBe(base);
        expect(signalMessage(key, otherKey, { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 BB' } })).not.toBe(base);
    });

    test('a null field and an empty one sign differently', () => {
        const withNull = signalMessage(key, otherKey, {
            connectionId: 'attempt-1',
            signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null }
        });
        const withEmpty = signalMessage(key, otherKey, {
            connectionId: 'attempt-1',
            signal: { kind: 'candidate', candidate: '', sdpMid: '', sdpMLineIndex: null }
        });
        expect(withNull).not.toBe(withEmpty);
    });

    test('a field with a newline in it cannot pass for two fields', () => {
        expect(accessRequestMessage('machine-1', `${key}\n${nonce}`, '')).not.toBe(accessRequestMessage(`machine-1\n${key}`, nonce, ''));
        expect(brokerHelloMessage('a\nb', 'machine', key, nonce).split('\n')).toHaveLength(2);
    });

    test('a statement binds its expiry', () => {
        expect(accessStatementMessage('machine-1', key, nonce, 0, 120_000)).not.toBe(accessStatementMessage('machine-1', key, nonce, 0, 119_999));
    });

    test('an offer signs the statement it carries, and one without a statement signs as before', () => {
        const statement = { machineId: 'machine-1', clientPublicKey: key, nonce, issuedAt: 0, expiresAt: 120_000, signature: 's'.repeat(86) };
        const bare: SignalEnvelope = { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0' } };
        const carrying: SignalEnvelope = { connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0', access: { statement, label: 'Laptop' } } };
        const base = signalMessage(key, otherKey, carrying);

        expect(signalMessage(key, otherKey, bare)).toBe(`${SIGNING_PURPOSES.signal}\n${JSON.stringify([key, otherKey, 'attempt-1', 'offer', 'v=0'])}`);
        expect(base).not.toBe(signalMessage(key, otherKey, bare));
        const swapped = (patch: Partial<typeof statement>, label = 'Laptop'): string =>
            signalMessage(key, otherKey, {
                connectionId: 'attempt-1',
                signal: { kind: 'offer', sdp: 'v=0', access: { statement: { ...statement, ...patch }, label } }
            });
        expect(swapped({ nonce: 'm'.repeat(22) })).not.toBe(base);
        expect(swapped({ machineId: 'machine-2' })).not.toBe(base);
        expect(swapped({ signature: 't'.repeat(86) })).not.toBe(base);
        expect(swapped({}, 'Phone')).not.toBe(base);
    });
});
