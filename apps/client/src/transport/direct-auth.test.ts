import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { clientChannelMessage, daemonChannelMessage, localSecretChannelMessage, PROTOCOL_VERSION, type DirectChallengeFrame } from '@ruimte/contracts';
import type { ClientKey } from '@/endpoint/client-key';
import { proveChallenge } from './direct-auth';

const encoder = new TextEncoder();

const base64url = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString('base64url');

const keyPair = async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey));
    return {
        pair,
        publicKey,
        sign: async (message: string) => base64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encoder.encode(message))),
        verify: (message: string, signature: string) =>
            crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, Buffer.from(signature, 'base64url'), encoder.encode(message))
    };
};

const BINDING = '[["sha-256 AA"],["sha-256 BB"]]';
const DAEMON_ID = 'daemon-a';

const challengeFrom = async (daemon: Awaited<ReturnType<typeof keyPair>>, binding = BINDING): Promise<DirectChallengeFrame> => ({
    type: 'direct.challenge',
    challenge: 'nonce-1',
    daemon: { id: DAEMON_ID, publicKey: daemon.publicKey, signature: await daemon.sign(daemonChannelMessage(DAEMON_ID, 'nonce-1', binding)) }
});

describe('proveChallenge', () => {
    test('a pinned daemon that signed this binding gets a key signature over the same binding', async () => {
        const daemon = await keyPair();
        const client = await keyPair();
        const key: ClientKey = { publicKey: client.publicKey, sign: client.sign };
        const proof = await proveChallenge(
            { pinned: { publicKey: daemon.publicKey, daemonId: DAEMON_ID }, key, secret: null, label: 'box' },
            await challengeFrom(daemon),
            BINDING
        );
        expect(proof.type).toBe('direct.key');
        if (proof.type !== 'direct.key') {
            return;
        }
        expect(await client.verify(clientChannelMessage(DAEMON_ID, 'nonce-1', client.publicKey, BINDING), proof.signature)).toBe(true);
    });

    test('a daemon that signed another binding, or with another key, gets no proof', async () => {
        const daemon = await keyPair();
        const imposter = await keyPair();
        const client = await keyPair();
        const credentials = {
            pinned: { publicKey: daemon.publicKey, daemonId: DAEMON_ID },
            key: { publicKey: client.publicKey, sign: client.sign },
            secret: null,
            label: 'box'
        };
        await expect(proveChallenge(credentials, await challengeFrom(daemon, '[["sha-256 CC"],["sha-256 BB"]]'), BINDING)).rejects.toThrow(/did not prove/);
        await expect(proveChallenge(credentials, await challengeFrom(imposter), BINDING)).rejects.toThrow(/did not prove/);
    });

    test('the local secret goes out as the HMAC the daemon computes, never as itself', async () => {
        const daemon = await keyPair();
        const proof = await proveChallenge({ pinned: null, key: null, secret: 'local-secret', label: 'This machine' }, await challengeFrom(daemon), BINDING);
        const expected = createHmac('sha256', 'local-secret')
            .update(localSecretChannelMessage(DAEMON_ID, 'nonce-1', BINDING))
            .digest('base64url');
        expect(proof).toEqual({ type: 'direct.secret', protocol: PROTOCOL_VERSION, challenge: 'nonce-1', proof: expected });
    });

    test('a row with neither a pinned key nor the secret cannot connect directly', async () => {
        const daemon = await keyPair();
        await expect(proveChallenge({ pinned: null, key: null, secret: null, label: 'box' }, await challengeFrom(daemon), BINDING)).rejects.toThrow(
            /paired key/
        );
    });
});
