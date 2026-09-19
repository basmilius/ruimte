import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifySignature as verifyNode } from './verify-node.ts';
import { verifySignature as verifyWeb } from './verify-web.ts';

/* The two files are one function in two runtimes, so every case has to answer the same on both. */
const pair = generateKeyPairSync('ed25519');
const publicKey = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x;
const signatureOf = (message: string): string => sign(null, Buffer.from(message, 'utf8'), pair.privateKey).toString('base64url');

const both = async (key: string, message: string, signature: string): Promise<[boolean, boolean]> => [
    verifyNode(key, message, signature),
    await verifyWeb(key, message, signature)
];

describe('verifySignature', () => {
    test('takes a signature over exactly this message', async () => {
        expect(await both(publicKey, 'hello', signatureOf('hello'))).toEqual([true, true]);
    });

    test('refuses the same signature over another message', async () => {
        expect(await both(publicKey, 'hello ', signatureOf('hello'))).toEqual([false, false]);
    });

    test('refuses a signature made with another key', async () => {
        const other = generateKeyPairSync('ed25519');
        const otherKey = (other.publicKey.export({ format: 'jwk' }) as { x: string }).x;
        expect(await both(otherKey, 'hello', signatureOf('hello'))).toEqual([false, false]);
    });

    test('anything that is not a key never reaches the verifier', async () => {
        expect(await both('', 'hello', signatureOf('hello'))).toEqual([false, false]);
        expect(await both('not-a-key', 'hello', signatureOf('hello'))).toEqual([false, false]);
        expect(await both(`${publicKey}A`, 'hello', signatureOf('hello'))).toEqual([false, false]);
    });

    test('rubbish where a signature should be is an answer, not a throw', async () => {
        expect(await both(publicKey, 'hello', 'nonsense')).toEqual([false, false]);
    });
});
