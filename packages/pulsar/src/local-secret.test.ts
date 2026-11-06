import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { localChannelProof, localSecretChannelMessage, localSecretMac } from './index.ts';

const BINDING = '[["sha-256 AA"],["sha-256 BB"]]';

describe('local secret proofs', () => {
    test('the channel proof is the HMAC the daemon computed before it moved here', async () => {
        expect(await localChannelProof('the-secret', 'daemon-1', 'challenge-1', BINDING)).toBe('Nks32iUKVQ1xJO4H1QgwDFnW8kYkHrEZY84YJ-gyp34');
    });

    test('is HMAC-SHA256 in base64url, which a daemon on node computes alike', async () => {
        const message = localSecretChannelMessage('daemon-1', 'challenge-1', BINDING);
        expect(await localSecretMac('the-secret', message)).toBe(createHmac('sha256', 'the-secret').update(message).digest('base64url'));
    });

    test('depends on the secret, the daemon, the challenge and the binding', async () => {
        const base = await localChannelProof('the-secret', 'daemon-1', 'challenge-1', BINDING);
        expect(await localChannelProof('another', 'daemon-1', 'challenge-1', BINDING)).not.toBe(base);
        expect(await localChannelProof('the-secret', 'daemon-2', 'challenge-1', BINDING)).not.toBe(base);
        expect(await localChannelProof('the-secret', 'daemon-1', 'challenge-2', BINDING)).not.toBe(base);
        expect(await localChannelProof('the-secret', 'daemon-1', 'challenge-1', '[]')).not.toBe(base);
    });
});
