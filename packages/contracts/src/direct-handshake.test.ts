import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { clientChannelMessage, daemonChannelMessage } from '@ruimte/pulsar';
import {
    acceptedFrame,
    challengeFrame,
    daemonProvedItself,
    keyProofFrame,
    parseHandshakeFrame,
    parseProofFrame,
    refusedFrame,
    secretProofFrame
} from './direct-handshake.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

const BINDING = '[["sha-256 AA"],["sha-256 BB"]]';
const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');

function signed(message: string): string {
    return sign(null, Buffer.from(message), pair.privateKey).toString('base64url');
}

function verified(key: string, message: string, signature: string): boolean {
    return key === publicKey && verify(null, Buffer.from(message), pair.publicKey, Buffer.from(signature, 'base64url'));
}

function challengeOf(daemonId: string, binding = BINDING) {
    return challengeFrame({
        challenge: 'challenge-1',
        daemon: { id: daemonId, publicKey, signature: signed(daemonChannelMessage(daemonId, 'challenge-1', binding)) }
    });
}

describe('the frames of the handshake', () => {
    test('go over the wire as they always did, key for key', () => {
        const daemon = { id: 'daemon-1', publicKey: 'key', signature: 'signed' };
        expect(JSON.stringify(challengeFrame({ challenge: 'c', daemon }))).toBe(
            `{"type":"direct.challenge","protocol":${PROTOCOL_VERSION},"challenge":"c","daemon":{"id":"daemon-1","publicKey":"key","signature":"signed"},"compression":["deflate-raw"]}`
        );
        expect(JSON.stringify(acceptedFrame({ ticket: 't', expiresIn: 60 }))).toBe('{"type":"direct.accepted","ticket":"t","expiresIn":60}');
        expect(JSON.stringify(acceptedFrame(null))).toBe('{"type":"direct.accepted","ticket":null,"expiresIn":null}');
        expect(JSON.stringify(refusedFrame('no'))).toBe('{"type":"direct.refused","reason":"no"}');
        expect(JSON.stringify(refusedFrame('old', 2))).toBe('{"type":"direct.refused","reason":"old","protocol":2}');
    });

    test('are read back by the end that dials', () => {
        expect(parseHandshakeFrame(challengeOf('daemon-1'))?.type).toBe('direct.challenge');
        expect(parseHandshakeFrame(acceptedFrame(null))?.type).toBe('direct.accepted');
        expect(parseHandshakeFrame(refusedFrame('no'))?.type).toBe('direct.refused');
        expect(parseHandshakeFrame({ type: 'direct.key' })).toBeNull();
        expect(parseHandshakeFrame({ type: 'endpoint.info' })).toBeNull();
    });

    test('proofs are read back by the end that answers', async () => {
        const secret = await secretProofFrame('the-secret', 'daemon-1', 'challenge-1', BINDING);
        const key = await keyProofFrame({ publicKey, sign: signed }, 'daemon-1', 'challenge-1', BINDING);
        expect(parseProofFrame(secret)).toEqual(secret);
        expect(parseProofFrame(key)).toEqual(key);
        expect(parseProofFrame({ type: 'direct.accepted' })).toBeNull();
    });
});

describe('proving the daemon', () => {
    test('accepts the pinned daemon that signed this binding', async () => {
        expect(await daemonProvedItself({ publicKey, daemonId: 'daemon-1' }, challengeOf('daemon-1'), BINDING, verified)).toBe(true);
        expect(await daemonProvedItself({ publicKey, daemonId: null }, challengeOf('daemon-1'), BINDING, verified)).toBe(true);
    });

    test('refuses another key, another id and a binding of another channel', async () => {
        expect(await daemonProvedItself({ publicKey: 'other', daemonId: 'daemon-1' }, challengeOf('daemon-1'), BINDING, verified)).toBe(false);
        expect(await daemonProvedItself({ publicKey, daemonId: 'daemon-2' }, challengeOf('daemon-1'), BINDING, verified)).toBe(false);
        expect(await daemonProvedItself({ publicKey, daemonId: 'daemon-1' }, challengeOf('daemon-1'), '[]', verified)).toBe(false);
    });
});

describe('proving this end', () => {
    test('a key proof signs the client channel bytes under the daemon id it is given', async () => {
        const proof = await keyProofFrame({ publicKey, sign: signed }, 'daemon-1', 'challenge-1', BINDING);
        expect(proof).toMatchObject({ type: 'direct.key', protocol: PROTOCOL_VERSION, challenge: 'challenge-1', publicKey });
        expect(verified(publicKey, clientChannelMessage('daemon-1', 'challenge-1', publicKey, BINDING), proof.signature)).toBe(true);
        expect(verified(publicKey, clientChannelMessage('daemon-2', 'challenge-1', publicKey, BINDING), proof.signature)).toBe(false);
    });

    test('a secret proof carries the HMAC of the channel bytes and never the secret', async () => {
        const proof = await secretProofFrame('the-secret', 'daemon-1', 'challenge-1', BINDING);
        expect(proof).toEqual({
            type: 'direct.secret',
            protocol: PROTOCOL_VERSION,
            challenge: 'challenge-1',
            proof: 'Nks32iUKVQ1xJO4H1QgwDFnW8kYkHrEZY84YJ-gyp34'
        });
    });
});
